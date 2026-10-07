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
// envelope is defence in depth; blindness itself is proven by the observation log in `observe.ts`.

import { spawnSync } from "node:child_process"
import { existsSync, statSync } from "node:fs"
import { basename, isAbsolute, join, relative } from "node:path"
import { sha256File, sha256Text } from "./ledger.ts"

/** One entry of the fixed gate table. */
export interface GateSpec {
  /** The id a caller passes as `gate`. */
  id: string
  /** The exact command line, for the record's `cmd` field and for the denial/refusal sentence. */
  cmd: string
  /** The runner: `bun` for a package script, `node` for a repo script. */
  runner: "bun" | "node"
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
  /** The table entry that ran, so a caller can record its exact command line. */
  spec: GateSpec
  /** The exit code; `-1` when the runner could not be started at all, `124` on a timeout. */
  exit: number
  /** The child's combined stdout and stderr, untruncated — the caller writes this to the log. */
  output: string
  /** The log's last {@link TAIL_CHARS} characters, which is what a model turn should see. */
  tail: string
  /** The sha256 of the full output, which is what the record's `logSha256` cites. */
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
  /** The child's combined output, captured in memory and then written to the log. */
  const child = spawnSync(runnerPath(spec.runner), [...spec.argv], {
    cwd: workspace,
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
    shell: false,
  })
  /** The captured stdout and stderr, concatenated so the log is one artefact. */
  const output = String(child.stdout ?? "") + String(child.stderr ?? "")
  /** The exit code: a signal-terminated child reports `null`, which is a failure like any other. */
  const exit = typeof child.status === "number" ? child.status : child.signal !== null && child.signal !== undefined ? 124 : -1
  return {
    spec,
    exit,
    output,
    tail: output.length > TAIL_CHARS ? output.slice(output.length - TAIL_CHARS) : output,
    outputSha256: sha256Text(output),
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
