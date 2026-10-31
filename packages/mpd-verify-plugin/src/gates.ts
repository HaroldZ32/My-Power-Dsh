// THE WHITELISTED GATE RUNNER and the CONTENT-FREE ARTIFACT PROBE.
//
// These two tools are how a verifier that may not read the implementation still produces evidence it
// cannot fabricate. The runner accepts an ID from a FIXED table — never a command line — so "run the
// gate" cannot become "run anything". The probe answers what exists, how big it is and its hash, and
// nothing else: a probe that could return content would be a read of the implementation with extra
// steps, which is exactly what the blindness rule forbids.
//
// THE RESIDUAL, STATED WHERE IT LIVES (spec (c)): a gate's output may print source frames in a failure
// report, so `tail` is controlled black-box evidence rather than a proof of reading nothing. The
// envelope is defence in depth and blindness is DECLARED, never observed: no shipped composition writes
// the read-observation log in `observe.ts` (only the withdrawn guard reached its `noteCall`).

import { spawnSync } from "node:child_process"
import { existsSync, readFileSync, statSync } from "node:fs"
import { basename, isAbsolute, join, relative } from "node:path"
import { sha256File, sha256Text } from "./ledger.ts"
import type { LoopGateFile } from "./ledger.ts"

/** One entry of the fixed gate table. */
export interface GateSpec {
  /** The id a caller passes as `gate`. */
  id: string
  /** The exact command line, for the record's `cmd` field and for the denial/refusal sentence. */
  cmd: string
  /**
   * How the program is resolved: `bun` for a package script and `node` for a repo script (the FROZEN
   * entries), `argv` for a PROJECT entry whose `argv[0]` is the program itself — a PATH name or an
   * absolute path, spawned with `shell:false`.
   */
  runner: "bun" | "node" | "argv"
  /** The argument vector after the runner. */
  argv: readonly string[]
}

/**
 * THE FIXED TABLE (spec (c), frozen). No free-form command is accepted, ever.
 *
 * The ids are what a verifier names, so the table is the whole vocabulary of "what can be proven here".
 * Adding an id is a code change with a review, which is the point.
 */
export const GATE_TABLE: readonly GateSpec[] = [
  { id: "gates", cmd: "bun run verify:gates", runner: "bun", argv: ["run", "verify:gates"] },
  { id: "tests", cmd: "bun test packages", runner: "bun", argv: ["test", "packages"] },
  { id: "typecheck", cmd: "bun run typecheck", runner: "bun", argv: ["run", "typecheck"] },
  { id: "docs", cmd: "bun run verify:docs", runner: "bun", argv: ["run", "verify:docs"] },
  { id: "manifest", cmd: "bun run verify:manifest", runner: "bun", argv: ["run", "verify:manifest"] },
  { id: "comments", cmd: "bun run verify:comments", runner: "bun", argv: ["run", "verify:comments"] },
  { id: "rows", cmd: "bun run verify:rows", runner: "bun", argv: ["run", "verify:rows"] },
  // `vendor` was added by the captain's second amendment set: AC1's own command is the upstream
  // decoupling gate, and without an id for it NO conforming verifier seat could produce AC1's evidence.
  { id: "vendor", cmd: "node scripts/verify-vendor.ts", runner: "node", argv: ["scripts/verify-vendor.ts"] },
  { id: "dist", cmd: "node scripts/verify-dist-fresh.ts", runner: "node", argv: ["scripts/verify-dist-fresh.ts"] },
  { id: "pack", cmd: "node scripts/pack-mpd.ts", runner: "node", argv: ["scripts/pack-mpd.ts"] },
]

/** The most artifact paths one probe may carry, so a probe cannot become a directory walk. */
export const PROBE_PATH_LIMIT = 64

/** The most output characters a gate result hands back, so a log cannot flood a model turn. */
export const TAIL_CHARS = 4096

/** One artifact reading: what exists, how big, its hash — never its content. */
export interface ProbeReading {
  /** The path, workspace-relative where it is inside the workspace. */
  path: string
  /** Whether anything exists there. */
  exists: boolean
  /** `file`, `dir` or `absent`. */
  kind: "file" | "dir" | "absent"
  /** The file's size in bytes; 0 for a directory or an absent path. */
  bytes: number
  /** The sha256 of the file's bytes; empty for a directory or an absent path. */
  sha256: string
  /** The modification time, ISO; empty when absent. */
  mtime: string
}

/** What one gate run produced. */
export interface GateRunResult {
  /** The EFFECTIVE entry that ran (a project entry, or a frozen one), so a caller can record its command. */
  spec: GateSpec
  /** The exit code; `-1` when the runner could not be started at all, `124` on a timeout. */
  exit: number
  /** The child's combined stdout and stderr, untruncated. */
  output: string
  /** The log's exact bytes: a header line naming the effective `cmd`, then {@link GateRunResult.output}. */
  log: string
  /** The log's last {@link TAIL_CHARS} characters, which is what a model turn should see. */
  tail: string
  /** The sha256 of {@link GateRunResult.log}'s bytes, which is what the record's `logSha256` cites. */
  outputSha256: string
}

/**
 * Look one gate up by id.
 *
 * @param id - the caller's `gate` argument.
 * @returns the entry, or `undefined` when the id is not on the table.
 */
export function gateById(id: string): GateSpec | undefined {
  return GATE_TABLE.find((entry) => entry.id === id)
}

/** The workspace-root file a project uses to declare or override its gates (C3, D13). */
export const PROJECT_GATE_FILE = "mpd-gates.json"

/** The most gates one project file may declare. */
export const PROJECT_GATE_LIMIT = 32

/** A project gate id: a lowercase letter first, then letters, digits and hyphens, at most 32 chars. */
export const PROJECT_GATE_ID_PATTERN: RegExp = /^[a-z][a-z0-9-]{0,31}$/

/** The most arguments one project gate may carry. */
export const PROJECT_GATE_ARGV_LIMIT = 32

/** The most characters one argument, or one `cmd` label, may carry. */
export const PROJECT_GATE_ARG_LIMIT = 4096

/** What a workspace's project gate file resolved to: its entries, or the ONE sentence that refuses a call. */
export type ProjectGateLoad =
  /** The usable project entries, in declaration order; empty when the file is absent. */
  | { readonly ok: true; readonly specs: readonly GateSpec[] }
  /** The refusal a gate call returns INSTEAD of falling back to the frozen table. */
  | { readonly ok: false; readonly refused: string }

/** One gate id resolved for a workspace: the project's entry first, the frozen table second. */
export type GateLookup =
  /** The effective entry that will run. */
  | { readonly ok: true; readonly spec: GateSpec }
  /** The ONE sentence that refuses the call (a malformed project file, or an id nothing declares). */
  | { readonly ok: false; readonly refused: string }

/**
 * One short fragment describing a thrown value, for a refusal that must name the problem.
 *
 * @param error - the thrown value.
 * @returns the error's message, or its string form when it is not an Error.
 */
function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * The ONE-sentence refusal a malformed project gate file produces.
 *
 * It NAMES the file and the problem on purpose: a caller that cannot see which file it tripped over has
 * no repair. The call is refused rather than falling back, because running a different command than the
 * project declared is exactly the surprise this file exists to remove.
 *
 * @param problem - what is wrong with the file, in a short phrase.
 * @returns the refusal result.
 */
function refuseProjectFile(problem: string): ProjectGateLoad {
  return {
    ok: false,
    refused: PROJECT_GATE_FILE + " at the workspace root is invalid (" + problem + "), so the gate call is refused instead of falling back to the frozen table",
  }
}

/**
 * Whether a parsed JSON value is a plain object — never `null`, never an array.
 *
 * @param value - the parsed value.
 * @returns true for an object literal.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * Load the workspace's project gate file (C3).
 *
 * ABSENT is not an error: a workspace that ships no `mpd-gates.json` uses the frozen table exactly as
 * before. A file that EXISTS must be well formed, and every malformation is refused HERE — with the file
 * name and the problem — rather than falling back, because a fallback would run a command the project
 * never declared.
 *
 * @param workspace - the workspace root the calling session resolved.
 * @returns the project entries in declaration order, or the one-sentence refusal.
 */
export function loadProjectGates(workspace: string): ProjectGateLoad {
  /** The project file's absolute path. */
  const file = join(workspace, PROJECT_GATE_FILE)
  if (!existsSync(file)) return { ok: true, specs: [] }
  /** The file's text, empty until it is read. */
  let text = ""
  try {
    text = readFileSync(file, "utf8")
  } catch (error) {
    return refuseProjectFile("it cannot be read (" + describeError(error) + ")")
  }
  /** The parsed JSON value, `undefined` until it parses. */
  let parsed: unknown = undefined
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    return refuseProjectFile("it is not valid JSON (" + describeError(error) + ")")
  }
  if (!isPlainObject(parsed)) return refuseProjectFile("the top level must be an object")
  /** The keys this shape allows at the top level. */
  const allowedTopLevel = new Set(["version", "gates"])
  for (const key of Object.keys(parsed)) {
    if (!allowedTopLevel.has(key)) return refuseProjectFile("unknown top-level key " + JSON.stringify(key))
  }
  if (parsed.version !== undefined && parsed.version !== 1) {
    return refuseProjectFile("version must be 1, got " + JSON.stringify(parsed.version))
  }
  if (!("gates" in parsed)) return refuseProjectFile("`gates` is missing")
  /** The declared gate entries, keyed by id. */
  const gates = parsed.gates
  if (!isPlainObject(gates)) return refuseProjectFile("`gates` must be an object of gate entries")
  /** The declared ids, in declaration order. */
  const ids = Object.keys(gates)
  if (ids.length > PROJECT_GATE_LIMIT) {
    return refuseProjectFile(ids.length + " gates are declared, and the limit is " + PROJECT_GATE_LIMIT)
  }
  /** The entries built so far. */
  const specs: GateSpec[] = []
  for (const id of ids) {
    if (!PROJECT_GATE_ID_PATTERN.test(id)) {
      return refuseProjectFile("gate id " + JSON.stringify(id) + " must match " + PROJECT_GATE_ID_PATTERN.source)
    }
    /** This entry, as declared. */
    const entry = gates[id]
    if (!isPlainObject(entry)) return refuseProjectFile("gate " + JSON.stringify(id) + " must be an object with `argv`")
    for (const key of Object.keys(entry)) {
      if (key !== "cmd" && key !== "argv") {
        return refuseProjectFile("gate " + JSON.stringify(id) + " declares unknown key " + JSON.stringify(key))
      }
    }
    /** The declared argument vector, when the entry carried an array at all. */
    const declared = entry.argv
    if (!Array.isArray(declared)) {
      return refuseProjectFile("gate " + JSON.stringify(id) + " needs `argv` to be an array of 1.." + PROJECT_GATE_ARGV_LIMIT + " strings")
    }
    if (declared.length < 1 || declared.length > PROJECT_GATE_ARGV_LIMIT) {
      return refuseProjectFile("gate " + JSON.stringify(id) + " declares " + declared.length + " argument(s), and `argv` must carry 1.." + PROJECT_GATE_ARGV_LIMIT)
    }
    /** The argument vector, narrowed to strings once every element is checked. */
    const argv: string[] = []
    for (let index = 0; index < declared.length; index += 1) {
      /** The argument at this position, as declared. */
      const argument: unknown = declared[index]
      if (typeof argument !== "string" || argument === "") {
        return refuseProjectFile("gate " + JSON.stringify(id) + " argv[" + index + "] must be a non-empty string")
      }
      if (argument.length > PROJECT_GATE_ARG_LIMIT) {
        return refuseProjectFile("gate " + JSON.stringify(id) + " argv[" + index + "] is " + argument.length + " characters long, and the limit is " + PROJECT_GATE_ARG_LIMIT)
      }
      argv.push(argument)
    }
    /** The command line the evidence header names: the declared `cmd`, else the argv's own spelling. */
    let cmd = argv.join(" ")
    if (entry.cmd !== undefined) {
      if (typeof entry.cmd !== "string" || entry.cmd.trim() === "") {
        return refuseProjectFile("gate " + JSON.stringify(id) + " `cmd` must be a non-empty string")
      }
      if (entry.cmd.length > PROJECT_GATE_ARG_LIMIT) {
        return refuseProjectFile("gate " + JSON.stringify(id) + " `cmd` is " + entry.cmd.length + " characters long, and the limit is " + PROJECT_GATE_ARG_LIMIT)
      }
      cmd = entry.cmd
    }
    specs.push({ id, cmd, runner: "argv", argv })
  }
  return { ok: true, specs }
}

/**
 * Resolve one gate id for a workspace: the PROJECT's entry first, the frozen table second.
 *
 * Precedence is what makes a project file an extension point rather than a replacement: an entry ADDS a
 * new id or OVERRIDES an existing one, and every id the project does not declare still resolves to its
 * frozen entry. A malformed project file refuses the CALL — it never degrades to the frozen table.
 *
 * @param workspace - the workspace root the calling session resolved.
 * @param id - the caller's `gate` argument.
 * @returns the effective entry, or the one-sentence refusal.
 */
export function resolveGate(workspace: string, id: string): GateLookup {
  /** The project file's entries, or the ONE sentence that refuses the whole call. */
  const project = loadProjectGates(workspace)
  if (!project.ok) return { ok: false, refused: project.refused }
  /** The project entry for this id, when the project declares one. */
  const declared = project.specs.find((entry) => entry.id === id)
  if (declared !== undefined) return { ok: true, spec: declared }
  /** The frozen entry: the fallback a project entry adds to or overrides, never removes. */
  const frozen = gateById(id)
  if (frozen !== undefined) return { ok: true, spec: frozen }
  // NO FREE-FORM COMMAND, EVER: an unknown id is refused with the whole effective vocabulary named
  // (project ids first, then the frozen ones), so a caller that guessed gets the ids instead of a
  // silent success.
  return {
    ok: false,
    refused: "unknown-gate: " + JSON.stringify(id) + " is not on the fixed table. The ids are: "
      + [...project.specs.map((entry) => entry.id), ...GATE_TABLE.map((entry) => entry.id)].join(", "),
  }
}

/**
 * One value rendered for the evidence log's header line.
 *
 * JSON is the base spelling because it is exact and unambiguous, but JSON alone does NOT escape the
 * U+007F-U+009F control range or the U+2028/U+2029 line separators — so those are escaped here as well.
 * The guarantee this buys (CR #11): a newline or line separator inside a project's `cmd` or one of its
 * `argv` elements can never start a line of its own in the log, which is the hashed artefact a record
 * cites.
 *
 * @param value - the string, array or record to render.
 * @returns a one-line, ASCII-safe JSON spelling.
 */
function headerValue(value: unknown): string {
  /** The value's JSON spelling; `null` for `undefined`, which the header never passes. */
  const json = JSON.stringify(value) ?? "null"
  return json.replace(/[\u007f-\u009f\u2028\u2029]/g, (character) => "\\u" + (character.codePointAt(0) ?? 0).toString(16).padStart(4, "0"))
}

/**
 * The identity of the workspace's project gate file RIGHT NOW: whether it exists, and the sha256 of its
 * bytes.
 *
 * `mpd_verify_open` freezes this into the loop (CR #12) and every gate run bound to that loop compares
 * against it: the write guard is withdrawn, so the loop's own WRITER can edit the file, and a byte-exact
 * freeze is what stops it from pointing a gate at a command that passes or relabelling one.
 *
 * @param workspace - the workspace root the calling session resolved.
 * @returns `{state:"absent"}` when there is no project file, else `{state:"present", sha256}` of its bytes.
 */
export function projectGateIdentity(workspace: string): LoopGateFile {
  /** The project file's absolute path. */
  const file = join(workspace, PROJECT_GATE_FILE)
  if (!existsSync(file)) return { state: "absent", sha256: "" }
  return { state: "present", sha256: sha256File(file) }
}

/**
 * The absolute path of the runner for one table entry.
 *
 * `bun` is resolved on PATH (it may not be the process running dsh), while `node` entries deliberately
 * use `process.execPath`: the harness already runs under some JavaScript runtime, and re-resolving a
 * bare `node` would pick a different one on a machine with several.
 *
 * @param runner - the entry's runner.
 * @returns the executable path, or the bare name when nothing resolves (spawnSync then reports ENOENT).
 */
export function runnerPath(runner: "bun" | "node"): string {
  if (runner === "node") return process.execPath
  /** Whether the current process is itself bun, which is the strongest answer available. */
  if (basename(process.execPath).startsWith("bun")) return process.execPath
  for (const dir of String(process.env.PATH ?? "").split(":")) {
    /** The candidate in this PATH entry. */
    const candidate = join(dir, "bun")
    if (dir !== "" && existsSync(candidate)) return candidate
  }
  return "bun"
}

/**
 * Run one whitelisted gate in the workspace root and write its log.
 *
 * @param workspace - the workspace root, which is the gate's cwd.
 * @param spec - the table entry to run.
 * @param timeoutMs - the wall-clock budget; on expiry the child is killed and the exit reported as 124.
 * @returns the run's result, with the tail already truncated.
 */
export function runGate(workspace: string, spec: GateSpec, timeoutMs: number): GateRunResult {
  /** The program to spawn: a frozen runner resolved here, or the project entry's own `argv[0]`. */
  const program = spec.runner === "argv" ? String(spec.argv[0] ?? "") : runnerPath(spec.runner)
  /** The arguments after the program: a project entry's own `argv`, or the frozen entry's full vector. */
  const argv = spec.runner === "argv" ? spec.argv.slice(1) : spec.argv
  /** The child's combined output, captured in memory and then written to the log. */
  const child = spawnSync(program, [...argv], {
    cwd: workspace,
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
    shell: false,
  })
  /**
   * The spawn failure, when the program could not be started at all or the child hit an OS-level limit.
   *
   * An ENOENT (missing toolchain) used to leave a log whose ONLY line was the header, so the caller got no
   * cause at all (CR #13). It is part of the OUTPUT on purpose, so it also reaches the `tail` a model reads.
   */
  const spawnFailure = child.error === undefined ? "" : "\n[spawn-error] " + describeError(child.error) + "\n"
  /** The captured stdout and stderr, plus the spawn failure, so the log is one artefact WITH a cause. */
  const output = String(child.stdout ?? "") + String(child.stderr ?? "") + spawnFailure
  /** The exit code: a signal-terminated child reports `null`, which is a failure like any other. */
  const exit = typeof child.status === "number" ? child.status : child.signal !== null && child.signal !== undefined ? 124 : -1
  // THE HEADER NAMES WHAT RAN (CR #14): the `cmd` label alone is a CLAIM — `cmd:"bun test packages"` with
  // `argv:["true"]` would certify a command that never executed. The program and the argv are the fact.
  /** The log's exact bytes: ONE header line naming the label, the program and the argv, then the output. */
  const log = "# gate " + spec.id + " cmd: " + headerValue(spec.cmd) + " program: " + headerValue(program) + " argv: " + headerValue([...argv]) + "\n" + output
  return {
    spec,
    exit,
    output,
    log,
    tail: output.length > TAIL_CHARS ? output.slice(output.length - TAIL_CHARS) : output,
    outputSha256: sha256Text(log),
  }
}

/**
 * Probe one list of paths, content-free.
 *
 * @param workspace - the workspace root; a path resolving OUTSIDE it is reported as absent rather than read.
 * @param paths - the paths to probe, at most {@link PROBE_PATH_LIMIT}.
 * @returns one reading per path, in the caller's order.
 */
export function probeArtifacts(workspace: string, paths: readonly string[]): ProbeReading[] {
  /** The readings, in the caller's order. */
  const readings: ProbeReading[] = []
  for (const raw of paths.slice(0, PROBE_PATH_LIMIT)) {
    /** The absolute candidate: a relative path resolves against the workspace root. */
    const absolute = isAbsolute(raw) ? raw : join(workspace, raw)
    /** The workspace-relative spelling, used for the report and for the containment test. */
    const rel = relative(workspace, absolute)
    if (rel.startsWith("..") || isAbsolute(rel)) {
      readings.push({ path: raw, exists: false, kind: "absent", bytes: 0, sha256: "", mtime: "" })
      continue
    }
    try {
      if (!existsSync(absolute)) {
        readings.push({ path: rel, exists: false, kind: "absent", bytes: 0, sha256: "", mtime: "" })
        continue
      }
      /** The stat for this path, read once. */
      const stat = statSync(absolute)
      if (stat.isDirectory()) {
        readings.push({ path: rel, exists: true, kind: "dir", bytes: 0, sha256: "", mtime: stat.mtime.toISOString() })
        continue
      }
      readings.push({
        path: rel,
        exists: true,
        kind: "file",
        bytes: stat.size,
        sha256: sha256File(absolute),
        mtime: stat.mtime.toISOString(),
      })
    } catch {
      readings.push({ path: raw, exists: false, kind: "absent", bytes: 0, sha256: "", mtime: "" })
    }
  }
  return readings
}
