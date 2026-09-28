#!/usr/bin/env node
// mpd-doctor: per-entry toolchain doctor.
//
// WHAT IT DOES: for every toolchain entry this bundle resolves, print ONE named
// line carrying the entry id, its REQUIRED/OPTIONAL class, the RESOLVED PATH and
// VERSION - or `MISSING ⇒ degrades: <what>`. There is never one opaque "doctor
// ok" line: an absent tool is reported as itself, with the tier that missed it.
//
// ENTRY TABLE (every resolution order below is read from the shipped code, never
// guessed; the `plan` lines of the output carry the same table at run time):
//
//  id              | env key(s)                                  | class    | resolution order
//  ----------------|---------------------------------------------|----------|------------------
//  node            | -                                           | REQUIRED | PATH lookup `node` (what every row's `command: node` uses) -> this doctor's own process.execPath
//  ast-grep        | MPD_AST_GREP_SG_PATH, MPD_AST_GREP_BIN_DIR   | OPTIONAL | env pin (a non-empty pin wins untouched) -> $MPD_AST_GREP_BIN_DIR/{ast-grep,sg} -> createRequire(@ast-grep/cli) package bin -> <bundle>/.toolchain/node_modules/.bin/{ast-grep,sg}; every candidate must pass the `--version` probe whose output contains "ast-grep" (the deprecated `sg` wrapper fails it); NO PATH tier in the MPD resolver - the adopted server's own PATH fallback is reported, not used
//  codegraph       | MPD_CODEGRAPH_BIN, MPD_DSH_CODEGRAPH_BIN     | OPTIONAL | env pin -> createRequire(@colbymchenry/codegraph) `bin` entry -> <bundle>/.toolchain/node_modules/.bin/codegraph -> PATH lookup `codegraph` (the plugin's last tier; the MCP launcher stops before it)
//  lsp             | MPD_DSH_LSP_CLI                              | REQUIRED | env override -> <bundle>/packages/mpd-mcp-lsp/dist/cli.js (the row launches `node <that file> mcp`); no PATH tier for the entrypoint
//  git-bash        | MPD_DSH_GITBASH_CLI                          | OPTIONAL | win32: %ProgramFiles%\Git\bin\bash.exe -> %ProgramFiles(x86)%\Git\bin\bash.exe -> `where bash` filtered to bash.exe outside system32/WindowsApps; posix: not-required (the row is `disabled: true` and `run` is Windows-only)
//  comment-checker | MPD_DSH_COMMENT_CHECKER_BIN                  | OPTIONAL | env override -> createRequire(@code-yeongyu/comment-checker) vendor/<platform>-<arch>/comment-checker -> <bundle>/.toolchain/node_modules/@code-yeongyu/comment-checker/{vendor/<platform>-<arch>/comment-checker,bin/comment-checker}
//
// Resolution sources: packages/mpd-mcp-shared/bin-resolve.ts,
// packages/mpd-mcp-{astgrep,codegraph}/launch.ts, packages/mpd-codegraph-plugin/src/index.ts,
// packages/mpd-comment-checker-plugin/src/index.ts, packages/mpd-mcp-{lsp,gitbash}/dist/cli.js,
// packages/mpd-bundle/cordis.patch.yml, package.json optionalDependencies.
//
// EXIT CODES (the verdict line always names the rule that decided the code):
//   0  every entry resolved;
//   1  at least one REQUIRED entry is missing (its row cannot start at all);
//   2  no REQUIRED entry missing, but OPTIONAL entries are (degraded, not broken);
//   64 usage error.
//
// PROBES: every version probe carries a hard timeout (SIGKILL on expiry). A tool
// that never answers is reported as MISSING-with-reason (the no-hang rule), and so
// is a file that cannot be executed at all; a tool that exits non-zero without a
// version flag stays ok with its probe reason named and its version taken from the
// nearest package.json.
//
// USAGE: node ./scripts/mpd-doctor.ts [--json] [--bundle-root <dir>] [--help]
//        node ./scripts/mpd-doctor.ts --self-test
//
// `--bundle-root <dir>` resolves every bundle-relative entry against <dir>
// instead of this checkout (packed/relocated installs; the self-test builds a
// temp fixture this way). It roots the bundle's node_modules lookups too, so a
// fixture cannot see the real tree.
import { execFileSync, spawnSync } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { delimiter, dirname, extname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { readJson } from "./lib/repo.ts"
import { resolveAstGrepBinary, resolveCodegraphBinary } from "../packages/mpd-mcp-shared/bin-resolve.ts"
import type { ResolverEnv } from "../packages/mpd-mcp-shared/bin-resolve.ts"

/** Every line this doctor prints is prefixed with this marker, so one grep separates its output. */
const PREFIX = "[mpd-doctor]"

/** This script's own path, which the self-test hands to the child so the child IS the tested build. */
const SCRIPT_PATH = fileURLToPath(import.meta.url)

/** The bundle root when `--bundle-root` is absent: the parent directory of `scripts/`. */
const DEFAULT_BUNDLE_ROOT = resolve(dirname(SCRIPT_PATH), "..")

/** Hard cap, in milliseconds, on one `--version` probe before it is killed and called a miss. */
const PROBE_TIMEOUT_MS = 10_000

/** Maximum characters of probe output kept in a report line, so one chatty tool cannot flood it. */
const MAX_PROBE_OUTPUT = 200

/** The process exit codes, one per verdict class (the header's EXIT CODES table). */
const EXIT = { ok: 0, requiredMissing: 1, optionalMissing: 2, usage: 64 } as const

/** The verdict rule sentence per exit code, printed on the `verdict=` line as the deciding rule. */
const RULE: Record<number, string> = {
  0: "exit 0 = every entry (REQUIRED and OPTIONAL) resolved",
  1: "exit 1 = at least one REQUIRED entry is missing (its row cannot start at all)",
  2: "exit 2 = no REQUIRED entry missing; only OPTIONAL entries are missing (degraded, not broken)",
  64: "exit 64 = usage error",
}

/**
 * Write one report line to stdout under the doctor's prefix.
 * @param line - the message body, without the prefix or the trailing newline
 */
function out(line: string): void { process.stdout.write(PREFIX + " " + line + "\n") }

/**
 * Write one diagnostic line to stderr under the doctor's prefix.
 * @param line - the message body, without the prefix or the trailing newline
 */
function err(line: string): void { process.stderr.write(PREFIX + " " + line + "\n") }

/**
 * A trimmed non-empty string, or null when the value is absent, blank or not a string.
 * @param value - the raw value, typically a `process.env` entry
 * @returns the trimmed string, or null when there is no usable value
 */
function nonEmpty(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null
}

/**
 * Collapse arbitrary text to one whitespace-normalised line, truncated with `...` past `max`.
 * @param text - the raw text (a Buffer or string); null/undefined read as empty
 * @param max - the character budget before truncation, defaulting to the report cap
 * @returns the flattened, possibly truncated, single line
 */
function oneLine(text: unknown, max: number = MAX_PROBE_OUTPUT): string {
  /** The whole value as one collapsed line, before the length cap is applied. */
  const flat = String(text === undefined || text === null ? "" : text).replace(/\s+/g, " ").trim()
  return flat.length > max ? flat.slice(0, max) + "..." : flat
}

/** The subset of a probe answer `versionOf` reads: acceptance, the answer, and the failure reason. */
interface ProbeAnswer {
  /** Whether the tool answered with exit 0. */
  ok: boolean
  /** The flattened answer, empty when the probe failed. */
  out: string
  /** Why the probe produced no version, empty when it succeeded. */
  reason: string
}

/** One `--version` probe's full outcome, including the two markers the resolver makes fatal. */
interface ProbeResult extends ProbeAnswer {
  /** Whether the probe was killed by the hard timeout (the no-hang case). */
  timedOut: boolean
  /** Whether the tool never ran at all (spawn failure, not executable, exit 127). */
  fault: boolean
}

/**
 * Version probe with a hard timeout: a tool that answers nothing is reported
 * with its reason (or as MISSING where the resolver makes the probe the
 * acceptance rule), never left hanging and never fatal.
 * `fault` marks a probe that never RAN the tool (spawn failure, not executable,
 * exit 127 "command not found") - the file exists but cannot be executed.
 * @param file - the executable, node script or command script to probe
 * @param args - the arguments to pass, defaulting to the `--version` probe
 * @returns the acceptance flag, the flattened answer, the reason and the two fault markers
 */
function probe(file: string, args: string[] = ["--version"]): ProbeResult {
  // A candidate is not always directly executable: a `.cmd`/`.bat` needs the platform shell
  // (EINVAL without one) and a `.js` bin entry needs a runtime (EFTYPE without one). Both
  // shapes mirror the real consumers - `spawnChild` in scripts/dump-config.ts and
  // `resolveServeProcessInvocation` in packages/mpd-mcp-codegraph/dist/serve.js - so the
  // reported version is the version the product itself would see.
  /** Whether the path is a win32 command script, which only a shell can start. */
  const commandScript = isCommandScript(file)
  /** Whether the path is an on-disk node script, which only a runtime can start. */
  const nodeScript = !commandScript && isNodeScript(file) && existsSync(file)
  /** The program to spawn: the shell for a command script, node for a script, else the file itself. */
  const spawnFile = commandScript ? commandInterpreter() : nodeScript ? process.execPath : file
  /** The argument vector matching `spawnFile`'s shape (the shell needs `/d /c <file>`). */
  const spawnArgs = commandScript ? ["/d", "/c", file, ...args] : nodeScript ? [file, ...args] : args
  try {
    /** The probe's stdout, decoded to UTF-8 by the `encoding` option. */
    const stdout = execFileSync(spawnFile, spawnArgs, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: PROBE_TIMEOUT_MS,
      killSignal: "SIGKILL",
      maxBuffer: 1024 * 1024,
    })
    return { ok: true, out: oneLine(stdout), reason: "", timedOut: false, fault: false }
  } catch (error) {
    // A thrown value is `unknown`, and `execFileSync` reports its own failure through this
    // optional field; the cast is that boundary and the read below is a literal comparison.
    const status = (error as { status?: unknown } | null | undefined)?.status
    return {
      ok: false,
      out: "",
      reason: probeFailureReason(error),
      timedOut: isTimeout(error),
      fault: typeof status !== "number" || status === 127,
    }
  }
}

/**
 * Whether a probe failure was the hard timeout rather than an answer.
 * @param error - the value `execFileSync` threw
 * @returns true when the child was killed by the timeout (ETIMEDOUT or SIGKILL)
 */
function isTimeout(error: unknown): boolean {
  // Same thrown-value boundary as `probe`: `Boolean(error)` is evaluated first, exactly as the
  // original did, so the two field reads below only happen for a truthy thrown value.
  const e = error as { code?: unknown; signal?: unknown }
  return Boolean(e) && (e.code === "ETIMEDOUT" || e.signal === "SIGKILL")
}

/**
 * A probe failure as one reported reason, in the precedence the resolver documents.
 * @param error - the value `execFileSync` threw
 * @returns the timeout sentence, the exit status, the errno code, or the failure message
 */
function probeFailureReason(error: unknown): string {
  if (!error) return "unknown probe failure"
  // The thrown-value boundary again: the four fields below are each compared against a literal,
  // and the falsy guard above already ruled out the values that would make the reads unsafe.
  const e = error as { code?: unknown; signal?: unknown; status?: unknown; message?: unknown }
  if (e.code === "ETIMEDOUT" || e.signal === "SIGKILL") return "timeout after " + PROBE_TIMEOUT_MS + "ms (killed; per the no-hang rule)"
  if (typeof e.status === "number") return "exit " + e.status + ", no version output"
  if (typeof e.code === "string") return e.code
  return oneLine(e.message ?? String(error))
}

/**
 * The spellings of a bare command name this platform resolves on PATH, in probe order.
 * win32 resolves a bare name through `%PATHEXT%` (the on-disk name of `node` ends in
 * `.exe`), so the extensionless POSIX spelling alone is not a lookup there. Measured
 * 2026-09-22: with only the bare spelling, this doctor reported that no `node` was on PATH
 * on a host whose PATH node was `C:/Program Files/nodejs/node.exe`.
 * @param command - the bare command name to spell
 * @param env - the env bag whose `%PATHEXT%` decides the suffixes on win32
 * @param platform - the platform whose lookup rules apply, defaulting to this process's
 * @returns every spelling to try, in order; always non-empty
 */
function pathSpellings(command: string, env: ResolverEnv, platform: string = process.platform): string[] {
  if (platform !== "win32") return [command]
  /** The caller's own `%PATHEXT%` entries, lower-cased so a case-varied host still matches. */
  const declared = String(env.PATHEXT ?? "")
    .split(";")
    .map((entry: string): string => entry.trim().toLowerCase())
    .filter((entry: string): boolean => entry.length > 0)
  /** The suffixes to try: the host's declared ones, else the documented win32 defaults. */
  const suffixes = declared.length > 0 ? declared : [".exe", ".com", ".cmd", ".bat"]
  return [...suffixes.map((suffix: string): string => command + suffix), command]
}

/**
 * First PATH entry that holds one of `command`'s spellings, or null when PATH has none.
 * @param command - the bare command name to look up
 * @param env - the env bag whose `PATH` (split on the platform delimiter) is searched
 * @returns the existing candidate path, or null when no spelling is on PATH
 */
function pathLookup(command: string, env: ResolverEnv): string | null {
  /** The spellings to try in each directory, in probe order. */
  const spellings = pathSpellings(command, env)
  for (const dir of String(env.PATH ?? "").split(delimiter)) {
    if (dir.length === 0) continue
    for (const spelling of spellings) {
      /** This directory's candidate under the current spelling. */
      const candidate = join(dir, spelling)
      if (existsSync(candidate)) return candidate
    }
  }
  return null
}

/**
 * Whether two paths name the same file on disk (symlinks and case resolved).
 * @param a - the first path
 * @param b - the second path
 * @returns true when both resolve and `realpathSync` agrees
 */
function samePath(a: string, b: string): boolean {
  try { return realpathSync(a) === realpathSync(b) } catch { return false }
}

/** The one field the version walk reads from a `package.json` it happens to pass. */
interface PackageManifestVersion {
  /** The package's declared version string, when the manifest carries a usable one. */
  version?: unknown
}

/**
 * The version in the nearest `package.json` above a resolved file, or null when there is none.
 * @param file - the resolved tool path the walk starts from
 * @returns the version with the manifest it came from, or null when no manifest answered
 */
function packageVersionNear(file: string): { version: string; source: string } | null {
  /** The directory the walk starts from: the file's real path, or its spelled path when unresolvable. */
  let dir: string
  try { dir = dirname(realpathSync(file)) } catch { dir = dirname(file) }
  // Three parents is enough for every layout here (package root, dist/, vendor/<key>/)
  // and stops the walk from reaching an unrelated manifest such as the repo root.
  for (let depth = 0; depth < 3; depth++) {
    /** The manifest candidate in the current directory. */
    const manifest = join(dir, "package.json")
    if (existsSync(manifest)) {
      try {
        /** The manifest's declared version field, read as unknown until it is narrowed. */
        const version = readJson<PackageManifestVersion>(manifest).version
        if (typeof version === "string" && version.length > 0) return { version, source: manifest }
      } catch { /* a broken manifest is not a version: keep walking up */ }
    }
    /** The next directory up, which ends the walk once it stops changing. */
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

/** A tool version plus the evidence it came from, as printed on the entry line. */
interface VersionInfo {
  /** The version string itself (`unknown` when nothing could answer). */
  version: string
  /** Where that version came from: the probe, a manifest, or the reason neither answered. */
  versionSource: string
  /** Why the probe itself produced no version, empty when the probe answered. */
  probeReason: string
}

/**
 * Version of a resolved tool: the probe answer when there is one, else the
 * nearest package.json version, else "unknown" - always with its source named.
 * @param file - the resolved tool path the probe ran against
 * @param probed - the probe answer (or a caller-computed one) for that path
 * @returns the version, its source and, when the probe failed, its reason
 */
function versionOf(file: string, probed: ProbeAnswer): VersionInfo {
  if (probed.ok && probed.out.length > 0) return { version: probed.out, versionSource: "`" + file + " --version`", probeReason: "" }
  /** The nearest manifest version, or null when no manifest answered. */
  const fallback = packageVersionNear(file)
  /** Why the probe yielded no version, in the probe's own words. */
  const why = probed.reason || "empty version output"
  if (fallback) return { version: fallback.version, versionSource: fallback.source + " (no --version answer: " + why + ")", probeReason: why }
  return { version: "unknown", versionSource: "no --version answer (" + why + ") and no package.json nearby", probeReason: why }
}

/** The no-hang contract, quoted verbatim into every rule a timeout decides. */
const NO_HANG_RULE = "a probe that never answers is treated as MISSING-with-reason (the no-hang rule), never as a silent ok"

/** The fields `acceptResolved` accepts from an entry resolver beside the path it resolved. */
interface ResolveFields {
  /** A probe answer the caller already has; omitted means `probe(path)` runs now. */
  probed?: ProbeResult
  /** The tier/route that produced the path, printed after `via=`. */
  via: string
  /** The rule sentence that decided this entry's status. */
  rule: string
  /** Extra evidence lines appended to the `checked:` list. */
  notes?: string[]
  /** The candidate paths that were consulted, printed after `checked:`. */
  checked?: string[]
}

/**
 * Publish a resolved path: `ok` with its version, unless the `--version` probe
 * HUNG - a tool that answers nothing is MISSING-with-reason, never a silent ok.
 * @param path - the resolved candidate the probe must accept
 * @param fields - the route, rule and evidence the caller already knows
 * @returns an `ok` record with the version, or a `missing` record naming probe and rule
 */
function acceptResolved(path: string, fields: ResolveFields): EntryOutcome {
  /** The caller's probe answer, or a fresh `--version` probe of the resolved path. */
  const probed = fields.probed ?? probe(path)
  if (probed.timedOut) {
    return result("missing", { ...fields, path: null, reason: "`" + path + " --version` " + probed.reason, rule: fields.rule + " (no-hang rule: " + NO_HANG_RULE + ")" })
  }
  if (probed.fault) {
    return result("missing", { ...fields, path: null, reason: "`" + path + " --version` cannot run the tool: " + probed.reason, rule: fields.rule + " (a present-but-unexecutable file is a fault, not a missing version flag)" })
  }
  return result("ok", { ...fields, path, ...versionOf(path, probed) })
}

/**
 * A `require.resolve` rooted at the bundle's own manifest, for the package tiers of a resolver.
 * @param bundleRoot - the bundle whose `node_modules` the resolution must be rooted in
 * @returns a specifier resolver that throws when the bundle cannot resolve the package
 */
function bundleRequireResolve(bundleRoot: string): (spec: string) => string {
  /** `createRequire` rooted at the bundle manifest, so a fixture cannot see the real tree. */
  const requireFromBundle = createRequire(join(bundleRoot, "package.json"))
  return (spec: string): string => requireFromBundle.resolve(spec)
}

/** The adopted chain's PATH fallback: the accepted candidate, and the candidates it refused. */
interface AstGrepFallback {
  /** The accepted PATH candidate, or null when the adopted chain accepts nothing. */
  path: string | null
  /** Refused candidates, each already flattened to `path (reason)`. */
  rejected: string[]
}

/**
 * The adopted ast-grep server's LAST resort when the MPD launcher leaves the env
 * unset: its own chain tries PATH (`ast-grep`, then `sg`) with the same
 * `--version` "ast-grep" acceptance. Reported as a fallback, never as a tier of
 * the MPD resolver.
 * @param env - the env bag whose PATH the adopted chain would search
 * @returns the accepted candidate (or null) plus the candidates it refused by name
 */
function astGrepPathFallback(env: ResolverEnv): AstGrepFallback {
  /** PATH candidates the adopted chain would refuse, each with the reason it is unusable. */
  const rejected: string[] = []
  for (const name of ["ast-grep", "sg"]) {
    /** This name's first existing PATH spelling, or null when PATH has none. */
    const candidate = pathLookup(name, env)
    if (candidate === null) continue
    /** The candidate's own `--version` answer. */
    const probed = probe(candidate)
    // The adopted chain accepts any EXISTING file here (its own isExecutable is F_OK on
    // win32), but the ast-grep RUNNER cannot start a command script: refuse it explicitly
    // rather than advertising a candidate that dies with EINVAL on the first tool call.
    if (!astGrepDirectlySpawnable(candidate)) {
      rejected.push(candidate + " (" + spawnShapeReason(candidate) + ")")
      continue
    }
    if (probed.ok && probed.out.toLowerCase().includes("ast-grep")) return { path: candidate, rejected }
    rejected.push(candidate + " (" + (probed.ok ? 'answered "' + probed.out + '"' : probed.reason) + ")")
  }
  return { path: null, rejected }
}

/**
 * The platform command interpreter a command script needs, as an ABSOLUTE path. A minimal
 * child env has neither ComSpec nor System32 on PATH (this doctor's own self-test fixture
 * drops everything but PATH/HOME), and a bare `cmd.exe` then answers ENOENT - the measured
 * reason a fixture stub was reported unrunnable instead of its probe being run.
 * @returns the absolute interpreter path from ComSpec, the system root, or the win32 default
 */
function commandInterpreter(): string {
  /** The host's `%ComSpec%`, when it names an interpreter. */
  const comspec = nonEmpty(process.env.ComSpec)
  if (comspec !== null) return comspec
  /** The Windows directory, from either of the two spellings the host may export. */
  const systemRoot = nonEmpty(process.env.SystemRoot) ?? nonEmpty(process.env.windir)
  if (systemRoot !== null) return join(systemRoot, "System32", "cmd.exe")
  return "C:\\Windows\\System32\\cmd.exe"
}

/**
 * Why the adopted ast-grep runner cannot start this path, in the shape of the file.
 * @param path - the candidate the runner would have to spawn
 * @returns the EINVAL/EFTYPE sentence matching the file's shape
 */
function spawnShapeReason(path: string): string {
  /** The candidate's lower-cased extension, which decides its shape. */
  const extension = extname(path).toLowerCase()
  if (extension === ".cmd" || extension === ".bat") return "a command script needs a shell, and the adopted runner starts its child with shell:false (EINVAL)"
  if (isNodeScript(path)) return "a node script needs a runtime, and the adopted runner execs the file itself (EFTYPE)"
  return "not an executable image, and the adopted runner execs the file itself (EFTYPE)"
}

/**
 * win32-only diagnosis for the ast-grep entry: a shim that exists in one of the searched bin
 * directories yet cannot be started shell-lessly. Naming the file is the point - a bare
 * "no candidate resolved" leaves a Windows user with a working `ast-grep.cmd` on disk and
 * nothing to act on.
 * @param ctx - the doctor's bundle root and env, which name the directories to search
 * @returns one note per refused shim, each naming the file and its reason
 */
function astGrepShimNotes(ctx: DoctorContext): string[] {
  /** The refusal notes, in the order the directories were searched. */
  const notes: string[] = []
  /** The bin directories the launcher searches: the env pin first, then the two bundle dirs. */
  const dirs = [
    nonEmpty(ctx.env.MPD_AST_GREP_BIN_DIR),
    join(ctx.bundleRoot, ".toolchain", "node_modules", ".bin"),
    join(ctx.bundleRoot, "node_modules", ".bin"),
  ]
  for (const dir of dirs) {
    if (dir === null) continue
    for (const name of ["ast-grep", "sg"]) {
      for (const spelling of pathSpellings(name, ctx.env)) {
        /** This directory's candidate under the current spelling. */
        const candidate = join(dir, spelling)
        if (!existsSync(candidate) || astGrepDirectlySpawnable(candidate)) continue
        notes.push("refused " + candidate + ": " + spawnShapeReason(candidate) + " - install the native ast-grep.exe or point MPD_AST_GREP_SG_PATH at one")
      }
    }
  }
  return notes
}

/** The three statuses an entry can end in, as printed on its line. */
type EntryStatus = "ok" | "missing" | "not-required"

/** The fields a result record is built from; each is optional and defaults as `result` documents. */
interface ResultFields {
  /** The resolved path, or null when nothing resolved. */
  path?: string | null
  /** The version string, defaulting to `unknown`. */
  version?: string
  /** Where the version came from, defaulting to `n/a`. */
  versionSource?: string
  /** The tier/route that produced the result, defaulting to `n/a`. */
  via?: string
  /** The rule sentence that decided the status. */
  rule?: string
  /** Why the entry is missing, when it is. */
  reason?: string
  /** Why the probe produced no version, when it did not. */
  probeReason?: string
  /** The entry's degrade sentence, appended to the table's own `degrade` text. */
  degradeSuffix?: string
  /** Extra evidence lines appended to the `checked:` list. */
  notes?: string[]
  /** The candidate paths that were consulted. */
  checked?: string[]
  /** A caller's probe answer carried through a spread; `result` itself reads only the fields above. */
  probed?: ProbeResult
}

/** One entry's outcome: everything its line is formatted from, before the static table fields join it. */
interface EntryOutcome {
  /** The entry's status on this platform. */
  status: EntryStatus
  /** The resolved path, or null when nothing resolved. */
  path: string | null
  /** The version, or `unknown` when nothing could answer. */
  version: string
  /** Where the version came from, or `n/a`. */
  versionSource: string
  /** The tier/route that produced the result, or `n/a`. */
  via: string
  /** The rule sentence that decided the status. */
  rule: string
  /** Why the entry is missing, empty when it is not. */
  reason: string
  /** Why the probe produced no version, empty when it answered. */
  probeReason: string
  /** The entry's degrade suffix, appended to the table's own `degrade` text. */
  degradeSuffix: string
  /** Extra evidence lines printed after `checked:`. */
  notes: string[]
  /** The candidate paths that were consulted, printed after `checked:`. */
  checked: string[]
}

/**
 * Build one entry outcome with every field defaulted, so a resolver only states what it knows.
 * @param status - the status this entry ended in
 * @param fields - the fields the resolver knows; every absent one takes its documented default
 * @returns the complete outcome record the formatter and the exit code read
 */
function result(status: EntryStatus, fields: ResultFields): EntryOutcome {
  return {
    status,
    path: fields.path ?? null,
    version: fields.version ?? "unknown",
    versionSource: fields.versionSource ?? "n/a",
    via: fields.via ?? "n/a",
    rule: fields.rule ?? "",
    reason: fields.reason ?? "",
    probeReason: fields.probeReason ?? "",
    degradeSuffix: fields.degradeSuffix ?? "",
    notes: fields.notes ?? [],
    checked: fields.checked ?? [],
  }
}

/** What one entry resolver is handed: the bundle root, the env bag and the platform in force. */
interface DoctorContext {
  /** The bundle root every bundle-relative candidate is resolved against. */
  bundleRoot: string
  /** The env bag to read: the caller's `process.env`, or the self-test fixture's. */
  env: ResolverEnv
  /** The platform whose resolution rules apply (`process.platform`, or a fixture's). */
  platform: string
}

/** One row of the entry table: its static identity, its prose and the resolver that decides it. */
interface EntrySpec {
  /** The entry id, printed at the start of every line about this entry. */
  id: string
  /** The entry's kind (`runtime`, `binary` or `mcp-entry`), carried into the JSON payload. */
  kind: string
  /** Whether a miss is fatal (exit 1) or a degrade (exit 2). */
  required: boolean
  /** The env keys this entry reads, printed as `env=` and carried into the JSON payload. */
  envKeys: string[]
  /** The resolution order as prose, printed on the `plan` line at run time. */
  resolution: string
  /** What breaks when this entry is missing, printed after `MISSING ⇒ degrades: `. */
  degrade: string
  /** Resolve this entry against `ctx`; a throw is reported by the caller as MISSING-with-reason. */
  resolve: (ctx: DoctorContext) => EntryOutcome
}

/** The entry table, in report order; every resolution order here is read from the shipped code. */
const ENTRY_SPECS: ReadonlyArray<EntrySpec> = [
  {
    id: "node",
    kind: "runtime",
    required: true,
    envKeys: [],
    resolution: "PATH lookup `node` (the interpreter every MCP row's `command: node` resolves) -> this doctor's own process.execPath",
    degrade: "no node on PATH: every `command: node` MCP row (ast_grep, lsp, codegraph) and every repo gate fails to spawn",
    /** The runtime entry: PATH `node` when the host has one, else this very process's own executable. */
    resolve(ctx: DoctorContext): EntryOutcome {
      /** The PATH spelling of `node`, or null when the host has none on PATH. */
      const onPath = pathLookup("node", ctx.env)
      /** The path to report: the PATH node when there is one, else this process's own executable. */
      const path = onPath ?? process.execPath
      /** What that path answers to `--version`. */
      const probed = probe(path)
      /** Evidence notes: the PATH miss is the one this entry exists to name. */
      const notes: string[] = []
      if (onPath === null) notes.push("no `node` on PATH: the rows' `command: node` would not resolve; this doctor runs on " + process.execPath)
      return result("ok", {
        path,
        version: probed.ok && probed.out ? probed.out : process.version,
        versionSource: probed.ok && probed.out ? "`node --version`" : "process.version (node --version: " + probed.reason + ")",
        via: onPath ? "PATH" : "process.execPath",
        rule: "the runtime is what launches every row; this entry is present whenever the doctor itself runs",
        notes,
        checked: ["PATH node" + (onPath ? "=" + onPath : " (none)"), "process.execPath=" + process.execPath],
      })
    },
  },
  {
    id: "ast-grep",
    kind: "binary",
    required: false,
    envKeys: ["MPD_AST_GREP_SG_PATH", "MPD_AST_GREP_BIN_DIR"],
    resolution: "MPD_AST_GREP_SG_PATH pin (a non-empty pin wins untouched in launch.ts) -> $MPD_AST_GREP_BIN_DIR/{ast-grep,sg} -> createRequire(@ast-grep/cli) package bin -> <bundle>/.toolchain/node_modules/.bin/{ast-grep,sg}; every candidate must pass the `--version` probe whose output contains \"ast-grep\" (the deprecated `sg` wrapper fails it); the MPD resolver has NO PATH tier",
    degrade: "the ast_grep MCP exposes no tools (mcp__ast_grep__search / mcp__ast_grep__scan / mcp__ast_grep__rewrite unavailable): dist/cli.js answers BINARY_NOT_FOUND - \"no candidate passed the --version probe across the env override, MPD runtime, skill bin cache, PATH, or Homebrew prefixes\"",
    /** The ast-grep entry: the single-path pin, then the shared resolver's tiers, then the missing-with-reason report. */
    resolve(ctx: DoctorContext): EntryOutcome {
      /** The candidate paths consulted, in the order the resolvers try them. */
      const checked: string[] = []
      /** Evidence notes: the adopted chain's fallback and this doctor's own scope limit. */
      const notes: string[] = []
      /** What the adopted chain's own PATH fallback would accept, with the candidates it refused. */
      const fallback = astGrepPathFallback(ctx.env)
      notes.push("adopted-chain PATH fallback: " + (fallback.path ? "accepts " + fallback.path : "nothing accepted" + (fallback.rejected.length ? " (rejected: " + fallback.rejected.join(" ; ") + ")" : " (no ast-grep/sg on PATH)")))
      notes.push("scope: the adopted server's MPD-runtime, skill-bin-cache and Homebrew tiers are not probed by this doctor")

      /** The single-path env pin, which wins untouched whenever it is non-empty. */
      const pin = nonEmpty(ctx.env.MPD_AST_GREP_SG_PATH)
      if (pin !== null) {
        checked.push("env pin MPD_AST_GREP_SG_PATH=" + pin + " (" + (existsSync(pin) ? "present" : "MISSING") + ")")
        if (!existsSync(pin)) {
          return result("missing", {
            rule: "a non-empty MPD_AST_GREP_SG_PATH wins untouched in launch.ts (no MPD-side substitution)",
            reason: "MPD_AST_GREP_SG_PATH=" + pin + " is set and does not exist",
            degradeSuffix: fallback.path ? " - the pin is stale rather than fatal: the adopted chain's own PATH fallback would accept " + fallback.path + ", so fix or unset the pin" : "",
            notes,
            checked,
          })
        }
        /** The pin's own `--version` answer. */
        const probed = probe(pin)
        if (!probed.ok || !probed.out.toLowerCase().includes("ast-grep")) {
          return result("missing", {
            rule: "a non-empty pin wins untouched, and every candidate must pass the `--version` ast-grep probe",
            reason: "MPD_AST_GREP_SG_PATH=" + pin + " exists but fails the probe (" + (probed.ok ? 'output "' + probed.out + '"' : probed.reason) + ")",
            degradeSuffix: fallback.path ? " - the adopted chain's own PATH fallback would accept " + fallback.path : "",
            notes,
            checked,
          })
        }
        return result("ok", { path: pin, version: probed.out, versionSource: "`" + pin + " --version`", via: "env pin MPD_AST_GREP_SG_PATH", rule: "a non-empty pin wins untouched", notes, checked })
      }

      /** The directory pin, consulted only when the single-path pin is unset. */
      const binDir = nonEmpty(ctx.env.MPD_AST_GREP_BIN_DIR)
      checked.push("$MPD_AST_GREP_BIN_DIR=" + (binDir ?? "<unset>") + "/{ast-grep,sg}")
      checked.push("createRequire(@ast-grep/cli/package.json) rooted at " + ctx.bundleRoot)
      /** The bundle's toolchain bin directory, the resolver's last tier. */
      const toolchainPair = join(ctx.bundleRoot, ".toolchain", "node_modules", ".bin")
      checked.push(toolchainPair + "/{ast-grep,sg}")
      /** The shared resolver's answer for this bundle root, or null when no tier accepted. */
      const resolved = resolveAstGrepBinary(join(ctx.bundleRoot, "scripts", "mpd-doctor.ts"), {
        env: ctx.env,
        bundleRoot: ctx.bundleRoot,
        requireResolve: bundleRequireResolve(ctx.bundleRoot),
      })
      if (resolved !== null) {
        /** The deprecated `sg` sibling beside the accepted binary, rejected by name. */
        const siblingSg = join(toolchainPair, "sg")
        if (existsSync(siblingSg) && !samePath(siblingSg, resolved.binary)) notes.push("rejected sibling candidate " + siblingSg + ": the deprecated `sg` wrapper exits 1 under `--version`")
        return acceptResolved(resolved.binary, {
          via: "MPD resolver source=" + resolved.source,
          rule: "env pin unset: packages/mpd-mcp-shared/bin-resolve.ts owns the order (BIN_DIR -> require -> .toolchain)",
          notes,
          checked,
        })
      }
      if (fallback.path !== null) {
        return acceptResolved(fallback.path, {
          via: "adopted-chain PATH fallback (the MPD launcher left MPD_AST_GREP_SG_PATH unset, so dist/cli.js runs its own chain)",
          rule: "the MPD resolver yields nothing, but the adopted chain accepts this PATH candidate",
          notes: notes.concat(["the MPD resolver found nothing: run `node ./scripts/install-mcp.ts` or set $MPD_AST_GREP_BIN_DIR"]),
          checked,
        })
      }
      /** Shim-shaped candidates that exist but cannot be started, named by the win32-only diagnosis. */
      const shimNotes = astGrepShimNotes(ctx)
      return result("missing", {
        rule: "env pin unset and no candidate accepted by the MPD resolver, and the adopted chain's PATH fallback accepts nothing either",
        reason: "no candidate resolved: pin unset, $MPD_AST_GREP_BIN_DIR " + (binDir === null ? "unset" : binDir) + ", @ast-grep/cli not resolvable from " + ctx.bundleRoot + ", no accepted " + toolchainPair + "/{ast-grep,sg}",
        notes: notes.concat(shimNotes),
        checked,
      })
    },
  },
  {
    id: "codegraph",
    kind: "binary",
    required: false,
    envKeys: ["MPD_CODEGRAPH_BIN", "MPD_DSH_CODEGRAPH_BIN"],
    resolution: "MPD_CODEGRAPH_BIN (then MPD_DSH_CODEGRAPH_BIN) pin: the mpd-codegraph plugin takes the first EXISTING candidate, while the MCP launcher passes a non-empty pin through untouched -> createRequire(@colbymchenry/codegraph) `bin` entry -> <bundle>/.toolchain/node_modules/.bin/codegraph -> PATH lookup `codegraph` (plugin only)",
    degrade: "the codegraph MCP exposes no tools (mcp__codegraph__explore unavailable) and /mpd-codegraph answers \"codegraph binary unavailable: install it or set MPD_DSH_CODEGRAPH_BIN\"; .codegraph/codegraph.db is never initialized",
    /** The codegraph entry: the env pin, then the shared resolver's tiers, then the plugin-only PATH tier. */
    resolve(ctx: DoctorContext): EntryOutcome {
      /** The candidate paths consulted, in the order the resolvers try them. */
      const checked: string[] = []
      /** Evidence notes: the remedy line when nothing resolves. */
      const notes: string[] = []
      /** The primary env pin, which the plugin prefers over the legacy key. */
      const primary = nonEmpty(ctx.env.MPD_CODEGRAPH_BIN)
      /** The pin actually in force: the primary key, else the legacy `MPD_DSH_CODEGRAPH_BIN`. */
      const pin = primary ?? nonEmpty(ctx.env.MPD_DSH_CODEGRAPH_BIN)
      /** Which of the two spellings supplied the pin, named in the report. */
      const pinKey = primary !== null ? "MPD_CODEGRAPH_BIN" : "MPD_DSH_CODEGRAPH_BIN"
      /** The shared resolver's answer, whose caller path is the plugin-relative launcher spelling. */
      const resolved = resolveCodegraphBinary(join(ctx.bundleRoot, "packages", "mpd-codegraph-plugin", "launch.mjs"), {
        env: ctx.env,
        bundleRoot: ctx.bundleRoot,
        requireResolve: bundleRequireResolve(ctx.bundleRoot),
      })
      /** The plugin's own last tier: a `codegraph` on PATH, which the MCP launcher never reaches. */
      const onPath = pathLookup("codegraph", ctx.env)
      /** What the plugin row would fall through to when a bad pin is in force, or null when nothing. */
      const fallback = resolved !== null ? resolved.binary : onPath
      checked.push(pin === null ? "env pin MPD_CODEGRAPH_BIN/MPD_DSH_CODEGRAPH_BIN: unset" : "env pin " + pinKey + "=" + pin + " (" + (existsSync(pin) ? "present" : "MISSING") + ")")
      checked.push("createRequire(@colbymchenry/codegraph/package.json) rooted at " + ctx.bundleRoot + " (bin entry, else bin/codegraph.js, else npm-shim.js)")
      checked.push(join(ctx.bundleRoot, ".toolchain", "node_modules", ".bin", "codegraph"))
      checked.push("PATH codegraph" + (onPath === null ? " (none)" : "=" + onPath))

      if (pin !== null && !existsSync(pin)) {
        return result("missing", {
          rule: "a non-empty " + pinKey + " pin wins untouched in launch.ts, so the MCP child takes source \"env\" and skips provisioning (zero tools, alive, exit 0)",
          reason: pinKey + "=" + pin + " is set and does not exist",
          degradeSuffix: fallback !== null ? " - the mpd-codegraph PLUGIN row falls through to " + fallback + ", but the MCP child keeps the bad pin" : " - the plugin row finds no fallback either",
          notes,
          checked,
        })
      }
      if (pin !== null) {
        return acceptResolved(pin, { via: "env pin " + pinKey, rule: "a non-empty pin wins untouched in launch.ts", notes, checked })
      }
      if (resolved !== null) {
        return acceptResolved(resolved.binary, { via: "MPD resolver source=" + resolved.source, rule: "pin unset: the shared resolver owns the order (require -> .toolchain)", notes, checked })
      }
      if (onPath !== null) {
        return acceptResolved(onPath, { via: "PATH (mpd-codegraph plugin tier; the MCP launcher does not reach it)", rule: "pin unset and the shared resolver yields nothing: the plugin's own PATH tier resolves this", notes, checked })
      }
      return result("missing", {
        rule: "pin unset, no require/toolchain candidate, and no `codegraph` on PATH",
        reason: "no candidate resolved: @colbymchenry/codegraph is not resolvable from " + ctx.bundleRoot + ", " + join(ctx.bundleRoot, ".toolchain", "node_modules", ".bin", "codegraph") + " is absent, PATH has no codegraph",
        notes: notes.concat(["`node ./scripts/install-mcp.ts` installs the codegraph toolchain"]),
        checked,
      })
    },
  },
  {
    id: "lsp",
    kind: "mcp-entry",
    required: true,
    envKeys: ["MPD_DSH_LSP_CLI"],
    resolution: "MPD_DSH_LSP_CLI -> <bundle>/packages/mpd-mcp-lsp/dist/cli.js (the `mcp-lsp` row launches `node <that file> mcp`); no PATH tier for the entrypoint - per-language servers (typescript-language-server, pyright-langserver, ...) resolve from PATH at use time",
    degrade: "the mcp-lsp row cannot start at all (node exits MODULE_NOT_FOUND), so no mcp__lsp__* tools exist (diagnostics, definition, references, rename): this is a hard fault, not a degrade",
    /** The REQUIRED lsp entry: the env override, else the bundle-shipped row entrypoint, with no fallback. */
    resolve(ctx: DoctorContext): EntryOutcome {
      /** The env override, when it names an entrypoint. */
      const override = nonEmpty(ctx.env.MPD_DSH_LSP_CLI)
      /** The bundle-shipped entrypoint the row falls back to. */
      const bundled = join(ctx.bundleRoot, "packages", "mpd-mcp-lsp", "dist", "cli.js")
      /** The entrypoint in force: the override first, the bundle-relative operand otherwise. */
      const path = override ?? bundled
      /** The tier that supplied the entrypoint, printed after `via=`. */
      const via = override !== null ? "env override MPD_DSH_LSP_CLI" : "bundle-shipped row entrypoint"
      if (!existsSync(path) || !isFile(path)) {
        return result("missing", {
          rule: "a REQUIRED row entrypoint has no fallback: the launcher is `node <file> mcp` and nothing substitutes a missing file",
          reason: override !== null ? "MPD_DSH_LSP_CLI=" + override + " is set and is not a file" : "the bundle-shipped CLI " + bundled + " is missing",
          checked: [override !== null ? "env override MPD_DSH_LSP_CLI=" + override : "env override MPD_DSH_LSP_CLI: unset", bundled],
        })
      }
      /** The entrypoint's `--version` answer, probed through this process's own node. */
      const probed = probe(process.execPath, [path, "--version"])
      return acceptResolved(path, { probed, via, rule: "env override first, then the bundle-relative row operand from cordis.patch.yml", notes: ["per-language servers are not probed here: they resolve from PATH when a session asks for them"], checked: ["env override MPD_DSH_LSP_CLI: " + (override ?? "unset"), bundled] })
    },
  },
  {
    id: "git-bash",
    kind: "mcp-entry",
    required: false,
    envKeys: ["MPD_DSH_GITBASH_CLI"],
    resolution: "MPD_DSH_GITBASH_CLI -> <bundle>/packages/mpd-mcp-gitbash/dist/cli.js (the `mcp-gitbash` row, `disabled: true` by default); the shell itself: win32 %ProgramFiles%\\Git\\bin\\bash.exe -> %ProgramFiles(x86)%\\Git\\bin\\bash.exe -> `where bash` filtered to bash.exe outside system32/WindowsApps; on posix resolveGitBash() answers source \"not-required\"",
    degrade: "on win32 without Git Bash: `git_bash` run/which_bash are unavailable (winget install --id Git.Git) - and the row is disabled by default, so nothing is lost until it is enabled; on posix the whole row is inert by design (run is Windows-only)",
    /** The git-bash entry: not-required on posix, and the row entrypoint plus the shell on win32. */
    resolve(ctx: DoctorContext): EntryOutcome {
      /** The env override, when it names an entrypoint. */
      const override = nonEmpty(ctx.env.MPD_DSH_GITBASH_CLI)
      /** The bundle-shipped entrypoint the row falls back to. */
      const bundled = join(ctx.bundleRoot, "packages", "mpd-mcp-gitbash", "dist", "cli.js")
      /** The entrypoint in force: the override first, the bundle-relative operand otherwise. */
      const cli = override ?? bundled
      /** The candidates consulted, starting with the entrypoint's own presence. */
      const checked = [override !== null ? "env override MPD_DSH_GITBASH_CLI=" + override : "env override MPD_DSH_GITBASH_CLI: unset", "row entrypoint " + cli + " (" + (isFile(cli) ? "present" : "MISSING") + ")"]
      if (ctx.platform !== "win32") {
        return result("not-required", {
          via: "resolveGitBash(): platform !== win32 -> { found: true, path: null, source: \"not-required\" }",
          rule: "the git_bash MCP answers \"disabled: git_bash command execution is only exposed on native Windows\", and the bundle row itself is `disabled: true`",
          notes: [isFile(cli) ? "the disabled row's entrypoint is present at " + cli : "the resolved row entrypoint " + cli + " is missing; enable the row only after fixing that"],
          checked,
        })
      }
      /** The shell resolution: the two Program Files spellings, then `where bash` filtered. */
      const bash = resolveWindowsBash(ctx.env)
      checked.push(...bash.checked)
      if (!isFile(cli)) {
        return result("missing", { rule: "the row's entrypoint must exist before the row can be enabled on win32", reason: "the row entrypoint " + cli + " is missing", notes: [bash.path !== null ? "the shell itself resolves at " + bash.path : "no Git Bash found either"], checked })
      }
      if (bash.path === null) {
        return result("missing", { rule: "win32: the MCP's own resolution is program-files -> program-files-x86 -> `where bash` (bash.exe only)", reason: "no Git Bash found", notes: ["install it with: winget install --id Git.Git -e --source winget"], checked })
      }
      return acceptResolved(bash.path, { probed: probe(bash.path, ["--version"]), via: "source=" + bash.source, rule: "win32 Git Bash resolution order (the row stays disabled until it is enabled)", notes: ["the row entrypoint itself is present at " + cli], checked })
    },
  },
  {
    id: "comment-checker",
    kind: "binary",
    required: false,
    envKeys: ["MPD_DSH_COMMENT_CHECKER_BIN"],
    resolution: "MPD_DSH_COMMENT_CHECKER_BIN -> createRequire(@code-yeongyu/comment-checker) vendor/<platform>-<arch>/comment-checker -> <bundle>/.toolchain/node_modules/@code-yeongyu/comment-checker/{vendor/<platform>-<arch>/comment-checker,bin/comment-checker}; the commentChecker.bin config key is read by the plugin and is NOT read by this doctor",
    degrade: "mpd_comment_check is unavailable (the opt-in detector is not installed): run `node ./scripts/install-mcp.ts --with-comment-checker` or set MPD_DSH_COMMENT_CHECKER_BIN; comment/docstring detection degrades to a tool error",
    /** The opt-in comment-checker entry: env override, resolvable package vendor binary, then `.toolchain`. */
    resolve(ctx: DoctorContext): EntryOutcome {
      /** The env override, which outranks every other tier. */
      const override = nonEmpty(ctx.env.MPD_DSH_COMMENT_CHECKER_BIN)
      /** The vendor key naming this platform's prebuilt binary. */
      const key = process.platform + "-" + (process.arch === "x64" ? "x64" : process.arch)
      /** The toolchain copy of the opt-in detector's package. */
      const toolchainRoot = join(ctx.bundleRoot, ".toolchain", "node_modules", "@code-yeongyu", "comment-checker")
      /** The candidates consulted, in the plugin's own order. */
      const checked = ["env override MPD_DSH_COMMENT_CHECKER_BIN: " + (override ?? "unset"), "createRequire(@code-yeongyu/comment-checker/package.json) rooted at " + ctx.bundleRoot, join(toolchainRoot, "vendor", key, "comment-checker"), join(toolchainRoot, "bin", "comment-checker")]
      /** The resolvable package's vendor binary, or null when the bundle cannot resolve the package. */
      let dependency: string | null = null
      try {
        /** The installed package's own manifest, as the bundle's linker resolves it. */
        const manifest = bundleRequireResolve(ctx.bundleRoot)("@code-yeongyu/comment-checker/package.json")
        dependency = join(dirname(manifest), "vendor", key, "comment-checker")
      } catch { /* not resolvable from this bundle root: the env override and .toolchain tiers remain */ }
      /** The tiers that exist on disk, in precedence order. */
      const candidates = [override, dependency, join(toolchainRoot, "vendor", key, "comment-checker"), join(toolchainRoot, "bin", "comment-checker")].filter((candidate: string | null): boolean => candidate !== null && existsSync(candidate))
      /** The first existing candidate, which is the path in force. */
      const path = candidates[0] ?? null
      if (path === null) {
        return result("missing", { rule: "env override -> resolvable package vendor binary -> <bundle>/.toolchain vendor/bin (no PATH tier in the plugin resolver)", reason: "no candidate resolved for platform key " + key, checked })
      }
      /** The resolved binary's `--version` answer. */
      const probed = probe(path)
      /** The tier that produced the path, printed after `via=`. */
      const via = path === override ? "env override MPD_DSH_COMMENT_CHECKER_BIN" : path === dependency ? "createRequire(@code-yeongyu/comment-checker)" : "<bundle>/.toolchain"
      return acceptResolved(path, { probed, via, rule: "the plugin's own order: config.bin -> MPD_DSH_COMMENT_CHECKER_BIN -> dependency -> .toolchain", notes: ["opt-in: only the mpd_comment_check tool uses this binary"], checked })
    },
  },
]

/**
 * win32-only: a `.cmd`/`.bat` is NOT directly spawnable - Node refuses one without a shell
 * (measured 2026-09-22: `execFileSync` on a command script answers EINVAL), and the adopted
 * ast-grep runner starts its child with `shell: false` (measured in
 * `packages/mpd-mcp-astgrep/dist/cli.js`). An npm/global install leaves exactly that shape
 * behind, so the doctor names the file it must refuse instead of losing the evidence.
 * @param path - the candidate to classify by its own extension
 * @returns true when the path is a win32 command script
 */
function isCommandScript(path: string): boolean {
  if (process.platform !== "win32") return false
  /** The candidate's lower-cased extension, which decides whether a shell is mandatory. */
  const extension = extname(path).toLowerCase()
  return extension === ".cmd" || extension === ".bat"
}

/**
 * A `bin` entry that is a node script. The adopters run one through the runtime rather than
 * exec it (measured 2026-09-22: `execFileSync` on `npm-shim.js` answers EFTYPE); the mirror
 * is `resolveServeProcessInvocation` in packages/mpd-mcp-codegraph/dist/serve.js.
 * @param path - the candidate to classify by its own extension
 * @returns true when the path ends in a node module extension (`.js`, `.cjs`, `.mjs`)
 */
function isNodeScript(path: string): boolean {
  return /\.[cm]?js$/i.test(path)
}

/**
 * Can the ADOPTED ast-grep runner start this path directly? It spawns with `shell: false`,
 * so win32 accepts an executable image only: an npm `.cmd` shim has no shell and a node shim
 * has no runtime (measured: EINVAL / EFTYPE). A candidate that fails this is still REPORTED -
 * as refused, by name - never silently dropped.
 * @param path - the candidate the adopted runner would have to spawn
 * @returns true on posix, and on win32 only for a native executable image (`.exe`/`.com`)
 */
function astGrepDirectlySpawnable(path: string): boolean {
  if (process.platform !== "win32") return true
  /** The candidate's lower-cased extension, which decides whether it is an executable image. */
  const extension = extname(path).toLowerCase()
  return extension === ".exe" || extension === ".com"
}

/**
 * Whether a path is an existing regular file (not a directory, not dangling).
 * @param path - the path to stat
 * @returns true only when the path is a regular file
 */
function isFile(path: string): boolean {
  try { return statSync(path).isFile() } catch { return false }
}

/** The Windows Git Bash resolution: the shell's path, the tier that found it, and the candidates tried. */
interface BashResolution {
  /** The resolved `bash.exe`, or null when win32 has no Git Bash. */
  path: string | null
  /** The tier that produced the path (`program-files`, `program-files-x86`, `path` or `missing`). */
  source: string
  /** The candidates consulted, in resolution order, as report lines. */
  checked: string[]
}

/**
 * Windows-only Git Bash resolution, mirroring packages/mpd-mcp-gitbash/dist/cli.js.
 * @param env - the env bag, kept for signature parity: this resolution reads no env of its own
 * @returns the resolved shell (or null) with the tier and the candidates consulted
 */
function resolveWindowsBash(env: ResolverEnv): BashResolution {
  /** The candidates consulted, in resolution order, with their outcome. */
  const checked: string[] = []
  for (const [candidate, source] of [["C:\\Program Files\\Git\\bin\\bash.exe", "program-files"], ["C:\\Program Files (x86)\\Git\\bin\\bash.exe", "program-files-x86"]]) {
    checked.push(candidate + " (" + (isFile(candidate) ? "present" : "MISSING") + ")")
    if (isFile(candidate)) return { path: candidate, source, checked }
  }
  /** `where bash` output, or "" when the lookup itself fails (no `where`, no PATH). */
  let whereOutput = ""
  try { whereOutput = execFileSync("where", ["bash"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: PROBE_TIMEOUT_MS }) } catch { whereOutput = "" }
  for (const raw of whereOutput.split(/\r?\n/)) {
    /** The trimmed `where` hit, skipped when the line is blank. */
    const candidate = raw.trim()
    if (candidate.length === 0) continue
    checked.push("where bash -> " + candidate)
    /** The hit with separators normalised, so the system32/WindowsApps filter matches either slash. */
    const normalized = candidate.replaceAll("/", "\\").toLowerCase()
    if (normalized.includes("\\windows\\system32\\") || normalized.includes("\\microsoft\\windowsapps\\")) continue
    if (candidate.toLowerCase().endsWith("bash.exe") && isFile(candidate)) return { path: candidate, source: "path", checked }
  }
  return { path: null, source: "missing", checked }
}

/** One entry's full record: its outcome plus the static table fields it was resolved from. */
interface DoctorEntry extends EntryOutcome {
  /** The entry id, printed at the start of its line. */
  id: string
  /** The entry's kind, carried into the JSON payload. */
  kind: string
  /** Whether a miss is fatal (exit 1) or a degrade (exit 2). */
  required: boolean
  /** The env keys the entry reads, printed as `env=`. */
  envKeys: string[]
  /** The resolution order as prose, printed on the `plan` line. */
  resolution: string
  /** What breaks when the entry is missing, plus the resolver's own suffix. */
  degrade: string
}

/** The verdict block: the exit code, its name and rule, and the two miss lists. */
interface DoctorVerdict {
  /** The process exit code this report yields. */
  code: number
  /** The verdict name printed on the `verdict=` line. */
  name: string
  /** The rule sentence that decided the code. */
  rule: string
  /** Ids of the REQUIRED entries that are missing. */
  missingRequired: string[]
  /** Ids of the OPTIONAL entries that are missing. */
  missingOptional: string[]
}

/** One full doctor run: the context it ran in, every entry outcome, and the verdict. */
interface DoctorReport {
  /** The bundle root every bundle-relative entry was resolved against. */
  bundleRoot: string
  /** The platform the resolution rules were evaluated for. */
  platform: string
  /** Every entry's outcome, in table order. */
  entries: DoctorEntry[]
  /** The verdict derived from those outcomes. */
  verdict: DoctorVerdict
}

/**
 * Resolve every entry of the table and fold the misses into one exit code.
 * @param ctx - the bundle root, env bag and platform this run resolves against
 * @returns the full report: every entry record plus the verdict it implies
 */
function doctor(ctx: DoctorContext): DoctorReport {
  /** Every entry's record, in table order. */
  const entries: DoctorEntry[] = ENTRY_SPECS.map((spec: EntrySpec): DoctorEntry => {
    /** This entry's outcome: its resolver's answer, or a MISSING-with-reason record when it throws. */
    let raw: EntryOutcome
    try {
      raw = spec.resolve(ctx)
    } catch (error) {
      raw = result("missing", {
        rule: "an entry resolver must never throw; a throw is reported as MISSING-with-reason",
        reason: "resolution threw: " + oneLine(error instanceof Error ? error.message : String(error)),
      })
    }
    return {
      id: spec.id,
      kind: spec.kind,
      required: spec.required,
      envKeys: spec.envKeys,
      resolution: spec.resolution,
      degrade: spec.degrade + (raw.degradeSuffix ?? ""),
      ...raw,
    }
  })
  /** The entries that are missing on this host. */
  const missing = entries.filter((entry: DoctorEntry): boolean => entry.status === "missing")
  /** The missing entries whose row cannot start at all. */
  const missingRequired = missing.filter((entry: DoctorEntry): boolean => entry.required)
  /** The missing entries that degrade a capability instead. */
  const missingOptional = missing.filter((entry: DoctorEntry): boolean => !entry.required)
  /** The exit code the two miss lists imply, REQUIRED first. */
  const code = missingRequired.length > 0 ? EXIT.requiredMissing : missingOptional.length > 0 ? EXIT.optionalMissing : EXIT.ok
  /** The verdict name matching that code. */
  const name = code === EXIT.ok ? "OK" : code === EXIT.requiredMissing ? "REQUIRED-MISSING" : "DEGRADED"
  return {
    bundleRoot: ctx.bundleRoot,
    platform: ctx.platform,
    entries,
    verdict: {
      code,
      name,
      rule: RULE[code],
      missingRequired: missingRequired.map((entry: DoctorEntry): string => entry.id),
      missingOptional: missingOptional.map((entry: DoctorEntry): string => entry.id),
    },
  }
}

/**
 * Print a report: one prefixed JSON line, or the plan/entry/verdict text block.
 * @param report - the report to print
 * @param args - the parsed CLI flags; `json` selects the single-line payload
 */
function emitReport(report: DoctorReport, args: ParsedArgs): void {
  if (args.json) {
    out("json " + JSON.stringify({ schema: "mpd-doctor/1", probeTimeoutMs: PROBE_TIMEOUT_MS, exitRule: RULE, ...report }))
    return
  }
  /** How many of the entries are REQUIRED, for the summary line. */
  const required = report.entries.filter((entry: DoctorEntry): boolean => entry.required).length
  out("toolchain doctor: " + report.entries.length + " entries (" + required + " REQUIRED / " + (report.entries.length - required) + " OPTIONAL), bundle-root=" + report.bundleRoot)
  out("platform=" + report.platform + "-" + process.arch + ", node " + process.version + ", probe timeout=" + PROBE_TIMEOUT_MS + "ms per `--version` probe")
  out("exit rule: 0 = every entry resolved; 1 = a REQUIRED entry is missing; 2 = only OPTIONAL entries are missing")
  for (const entry of report.entries) {
    out("plan " + entry.id + " [" + (entry.required ? "REQUIRED" : "OPTIONAL") + "] env=" + (entry.envKeys.length > 0 ? entry.envKeys.join(",") : "none") + " order=\"" + entry.resolution + "\"")
  }
  for (const entry of report.entries) out(formatEntry(entry))
  /** The miss summary appended to the verdict line, empty when nothing is listed. */
  const detail = [
    report.verdict.missingRequired.length > 0 ? "missingREQUIRED=" + report.verdict.missingRequired.join(",") : "required=all-present",
    report.verdict.missingOptional.length > 0 ? "missingOPTIONAL=" + report.verdict.missingOptional.join(",") : "",
  ].filter((part: string): boolean => part.length > 0).join(" ")
  out("verdict=" + report.verdict.name + " exit=" + report.verdict.code + " rule=\"" + report.verdict.rule + "\"" + (detail.length > 0 ? " " + detail : ""))
  if (report.verdict.code !== EXIT.ok) {
    out("remedy: node ./scripts/install-mcp.ts (toolchain binaries) | re-check: node ./scripts/mpd-doctor.ts")
  }
}

/**
 * One entry as its report line, shaped by its status (missing, not-required, or ok).
 * @param entry - the entry record to format
 * @returns the single line, prefixless (the caller adds the prefix)
 */
function formatEntry(entry: DoctorEntry): string {
  /** The REQUIRED/OPTIONAL class as printed on the line. */
  const cls = entry.required ? "REQUIRED" : "OPTIONAL"
  /** The `env=` clause naming the entry's keys, or `none`. */
  const env = "env=" + (entry.envKeys.length > 0 ? entry.envKeys.join(",") : "none")
  /** The ` | note:` clause carrying the resolver's evidence notes, empty when it has none. */
  const notes = entry.notes.length > 0 ? " | note: " + entry.notes.join(" ; ") : ""
  /** The ` | checked:` clause carrying the consulted candidates, empty when there are none. */
  const checked = entry.checked.length > 0 ? " | checked: " + entry.checked.join(" ; ") : ""
  if (entry.status === "missing") {
    return entry.id + " [" + cls + "]: MISSING ⇒ degrades: " + entry.degrade + " | rule: " + entry.rule + " | reason: " + entry.reason + checked + notes + " | " + env
  }
  if (entry.status === "not-required") {
    return entry.id + " [" + cls + "]: ok (not-required on " + process.platform + ") ⇒ degrades: " + entry.degrade + " | rule: " + entry.rule + " | via: " + entry.via + checked + notes + " | " + env
  }
  return entry.id + " [" + cls + "]: ok path=" + entry.path + " version=\"" + entry.version + "\" version-source=" + entry.versionSource + " via=" + entry.via + (entry.probeReason ? " probe=" + entry.probeReason : "") + checked + notes + " | " + env
}

/** Print the usage block, including the exit-code table, on stdout. */
function usage(): void {
  out("usage: node ./scripts/mpd-doctor.ts [--json] [--bundle-root <dir>] [--help]")
  out("       node ./scripts/mpd-doctor.ts --self-test")
  out("  --json                 one prefixed JSON line: `" + PREFIX + " json {...}` (the payload follows the marker)")
  out("  --bundle-root <dir>    resolve bundle-relative entries against <dir> instead of this checkout (must be an existing directory)")
  out("  --self-test            hermetic arms on a temp fixture (mkdtemp): never the real repo state")
  out("exit codes: 0 = every entry resolved; 1 = a REQUIRED entry is missing; 2 = only OPTIONAL entries are missing; " + EXIT.usage + " = usage error")
}

/** The parsed command line: the three flags, the resolved bundle root, and the first usage error. */
interface ParsedArgs {
  /** Whether `--self-test` was asked for. */
  selfTest: boolean
  /** Whether `--json` was asked for. */
  json: boolean
  /** Whether `--help`/`-h` was asked for. */
  help: boolean
  /** The bundle root in force: `--bundle-root`, else this checkout. */
  bundleRoot: string
  /** The first usage error, empty when the command line parsed cleanly. */
  error: string
}

/**
 * Parse the CLI arguments left to right, recording the first usage error rather than throwing.
 * @param argv - the arguments after the script path
 * @returns the parsed flags, the bundle root and any usage error
 */
function parseArgs(argv: string[]): ParsedArgs {
  /** The parsed flags, seeded with the defaults and the checkout's own bundle root. */
  const parsed: ParsedArgs = { selfTest: false, json: false, help: false, bundleRoot: DEFAULT_BUNDLE_ROOT, error: "" }
  for (let i = 0; i < argv.length; i++) {
    /** The argument at the cursor; `--bundle-root` also consumes the next one. */
    const arg = argv[i]
    if (arg === "--self-test") parsed.selfTest = true
    else if (arg === "--json") parsed.json = true
    else if (arg === "--help" || arg === "-h") parsed.help = true
    else if (arg === "--bundle-root") {
      /** The directory operand following `--bundle-root`, absent when the flag ends the line. */
      const value = argv[++i]
      if (value === undefined) parsed.error = "--bundle-root needs a directory argument"
      else parsed.bundleRoot = resolve(value)
    } else if (arg.startsWith("--bundle-root=")) parsed.bundleRoot = resolve(arg.slice("--bundle-root=".length))
    else parsed.error = "unknown argument: " + arg
  }
  return parsed
}

// ---------------------------------------------------------------------------
// self-test: every arm builds a TEMP fixture (stub binaries + a fixture env and
// PATH inside mkdtemp) and drives THIS script as a child process, so the
// assertions read the real observable - the printed lines and the exit code.
// ---------------------------------------------------------------------------

/** The exact prefix a JSON-mode line carries, so the payload can be sliced off it. */
const PREFIXED_JSON = PREFIX + " json "

/** A built fixture: the sandbox home, its PATH bin dir and the bundle root the child resolves against. */
interface Fixture {
  /** The fixture's home directory, exported to the child as HOME. */
  home: string
  /** The fixture's own bin directory, exported as the child's whole PATH. */
  bin: string
  /** The fixture bundle root handed to the child as `--bundle-root`. */
  bundle: string
}

/** The knobs one fixture is built with: what to leave out, what to hang, and which extra stubs to add. */
interface FixtureOptions {
  /** The per-arm directory name under the self-test root. */
  name: string
  /** Stub ids left unwritten, so the entry has to report the absence. */
  omit?: string[]
  /** Stub ids written as a never-answering stub, for the no-hang arm. */
  hang?: string[]
  /** Whether to add an `ast-grep` stub to the fixture's PATH as well as its toolchain bin dir. */
  pathAstGrep?: boolean
  /** Whether to add a foreign `sg` look-alike to the fixture's PATH, which must be rejected. */
  foreignSg?: boolean
}

/** One stub binary the fixture writes, at the path its resolver names. */
interface FixtureStub {
  /** The entry id the stub stands in for, which is also its `omit`/`hang` key. */
  id: string
  /** The absolute path the stub is written to. */
  file: string
  /** The stub's body when it is neither omitted nor hung. */
  body: string
}

/**
 * Build one arm's temp fixture: a bundle root carrying the stubs a passing entry needs.
 * @param root - the self-test's mkdtemp root, one subdirectory per fixture
 * @param options - what to omit, what to hang and which extra PATH stubs to add
 * @returns the fixture's home, PATH bin dir and bundle root
 */
function buildFixture(root: string, options: FixtureOptions): Fixture {
  /** The fixture's home directory, which also becomes the child's HOME. */
  const home = join(root, options.name)
  /** The fixture's bin directory, which becomes the child's whole PATH. */
  const bin = join(home, "bin")
  /** The fixture's bundle root, which the child resolves every bundle-relative entry against. */
  const bundle = join(home, "bundle")
  /** Stub ids to leave absent on disk. */
  const omit = new Set(options.omit ?? [])
  /** Stub ids to write as never-answering stubs. */
  const hang = new Set(options.hang ?? [])
  mkdirSync(bin, { recursive: true })
  mkdirSync(bundle, { recursive: true })
  writeFileSync(join(bundle, "package.json"), JSON.stringify({ name: "mpd-doctor-fixture", version: "0.0.0" }) + "\n")
  try { symlinkSync(process.execPath, join(bin, "node")) } catch { /* a fixture without a PATH node is reported by the node entry, never fatal */ }
  /** The bundle's toolchain bin dir, where the shared resolver's last tier looks. */
  const binDir = join(bundle, ".toolchain", "node_modules", ".bin")
  /** The three stubs, each written where its own resolver names it. */
  const stubs: FixtureStub[] = [
    { id: "ast-grep", file: stubPath(binDir, "ast-grep"), body: versionStub("ast-grep 9.9.9") },
    { id: "codegraph", file: stubPath(binDir, "codegraph"), body: versionStub("9.9.9") },
    // No suffix here on purpose: the plugin's own order names this file literally.
    { id: "comment-checker", file: join(bundle, ".toolchain", "node_modules", "@code-yeongyu", "comment-checker", "vendor", process.platform + "-" + process.arch, "comment-checker"), body: versionStub("9.9.9") },
  ]
  for (const stub of stubs) {
    if (omit.has(stub.id)) continue
    writeStub(stub.file, hang.has(stub.id) ? hangStub() : stub.body)
  }
  if (options.pathAstGrep) writeStub(stubPath(bin, "ast-grep"), versionStub("ast-grep 9.9.9"))
  if (options.foreignSg) writeStub(join(bin, "sg"), "#!/bin/sh\necho 'sg: shadow-utils look-alike, not ast-grep' >&2\nexit 1\n")
  for (const pkg of ["mpd-mcp-lsp", "mpd-mcp-gitbash"]) {
    writeStub(join(bundle, "packages", pkg, "dist", "cli.js"), "// fixture row entrypoint: like the real CLIs it has no --version flag\nprocess.exit(2)\n")
    writeFileSync(join(bundle, "packages", pkg, "package.json"), JSON.stringify({ name: "@mpd-dsh/" + pkg, version: "9.9.9" }) + "\n")
  }
  return { home, bin, bundle }
}

/**
 * A fixture stub is written as the PLATFORM's own kind of command. A `#!/bin/sh` file is not
 * executable on win32 (the probe answers ENOENT/EINVAL), so a POSIX-shaped fixture can only
 * ever measure the POSIX half of an entry there. Measured 2026-09-22: with `#!/bin/sh` stubs
 * four of the seven arms below failed on win32 for fixture reasons, not product reasons.
 * @param name - the logical stub name, without any extension
 * @returns the on-disk name, which carries `.cmd` on win32 so the stub is spawnable there
 */
function stubName(name: string): string { return process.platform === "win32" ? name + ".cmd" : name }

/**
 * A stub's absolute path inside a directory, under the platform's own stub spelling.
 * @param dir - the directory the stub lives in
 * @param name - the logical stub name, without any extension
 * @returns the absolute path to write the stub to
 */
function stubPath(dir: string, name: string): string { return join(dir, stubName(name)) }

/**
 * A stub body that answers `--version` with the given text, in an executable form per platform.
 * @param text - the version text the stub must print
 * @returns the stub file body
 */
function versionStub(text: string): string {
  return process.platform === "win32" ? "@echo off\r\necho " + text + "\r\n" : "#!/bin/sh\necho \"" + text + "\"\n"
}

/**
 * A stub that never answers `--version`. On win32 the wait must burn INSIDE the one process the
 * probe kills: a `ping`/`timeout` child would hold the pipe after the kill, so the arm would
 * measure a lingering grandchild instead of the no-hang rule.
 * @returns the stub file body
 */
function hangStub(): string {
  return process.platform === "win32" ? "@echo off\r\n:loop\r\ngoto loop\r\n" : "#!/bin/sh\nexec /bin/sleep 30\n"
}

/**
 * Write one executable stub, creating its parent directory when the layout needs one.
 * @param file - the absolute path to write
 * @param body - the stub's file body
 */
function writeStub(file: string, body: string): void {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, body)
  chmodSync(file, 0o755)
}

/**
 * The child's environment: a fresh PATH/HOME plus only the vars the arm itself pins.
 * @param fixture - the fixture whose bin dir and home become PATH and HOME
 * @param extra - the arm's own env pins (a bad binary path, a CLI override, ...)
 * @returns the env bag handed to the child
 */
function fixtureEnv(fixture: Pick<Fixture, "home" | "bin">, extra: Record<string, string> = {}): Record<string, string> {
  // A fresh PATH/HOME only: no MPD_* variable of the caller survives into an arm.
  return { PATH: fixture.bin, HOME: fixture.home, LANG: "C", NO_COLOR: "1", ...extra }
}

/** The child's two output streams, as the pieces an arm compares. */
interface ChildOutput {
  /** Everything the child wrote to stdout. */
  stdout: string
  /** Everything the child wrote to stderr. */
  stderr: string
}

/** The child run's observable: its exit code, both streams, any spawn error, and real-tree leaks. */
interface ChildRun extends ChildOutput {
  /** The child's exit code, or null when it never exited (spawn failure). */
  code: number | null
  /** Why the child could not be run at all, flattened to one line; empty when it ran. */
  detail: string
  /** Real-tree paths that appeared in the child's output, which must stay empty. */
  leak: string[]
}

/**
 * Drive this script as a child process, with the arm's env and a hard timeout.
 * @param args - the arguments to give the child
 * @param env - the child's whole environment
 * @returns its exit code, both streams, any spawn error, and any real-tree leak
 */
function runChild(args: string[], env: Record<string, string>): ChildRun {
  /** The finished child process, decoded to UTF-8 by the `encoding` option. */
  const spawned = spawnSync(process.execPath, [SCRIPT_PATH, ...args], { env, encoding: "utf8", timeout: 120_000, stdio: ["ignore", "pipe", "pipe"] })
  /** The child's stdout, or "" when it produced none. */
  const stdout = spawned.stdout ?? ""
  /** The child's stderr, or "" when it produced none. */
  const stderr = spawned.stderr ?? ""
  return {
    code: spawned.status,
    stdout,
    stderr,
    detail: spawned.error ? oneLine(spawned.error.message) : "",
    leak: [DEFAULT_BUNDLE_ROOT, join(DEFAULT_BUNDLE_ROOT, "node_modules")].filter((path: string): boolean => (stdout + stderr).includes(path)),
  }
}

/**
 * The child's report line for one entry id, or "" when the child printed none.
 * @param text - the child's whole stdout
 * @param id - the entry id whose line is wanted
 * @returns the first line starting with the prefixed id, or the empty string
 */
function entryLine(text: string, id: string): string {
  return text.split("\n").find((line: string): boolean => line.startsWith(PREFIX + " " + id + " [")) ?? ""
}

/**
 * A failed arm, carrying the child's output so the census can print the evidence.
 * @param detail - one line naming the assertion that failed
 * @param child - the child run (or null when the arm threw before running one)
 * @returns the failure verdict, with the child's two streams concatenated
 */
function armFail(detail: string, child: ChildOutput | null): ArmFail {
  return { ok: false, detail, child: child ? child.stdout + child.stderr : "" }
}

/** A self-test arm that measured what it asserted. */
interface ArmPass {
  /** Discriminant: every assertion in the arm held. */
  ok: true
  /** One line naming what the arm actually observed. */
  detail: string
}

/** A self-test arm whose assertion failed, with the child's output kept for the report. */
interface ArmFail {
  /** Discriminant: at least one assertion failed. */
  ok: false
  /** One line naming the assertion that failed. */
  detail: string
  /** The child's stdout+stderr, printed under the failing arm's line. */
  child: string
}

/** Either verdict a self-test arm can return. */
type ArmOutcome = ArmPass | ArmFail

/** One self-test arm: its report name and the fixture-driven body that drives this script as a child. */
type Arm = [name: string, run: (root: string) => ArmOutcome]

/** The self-test arms, each hermetic on the fixture root it is handed. */
const ARMS: ReadonlyArray<Arm> = [
  // Arm 1: every entry a POSIX fixture can fabricate resolves ok; win32 asserts the reported limits.
  ["all-present-fixture", (root: string): ArmOutcome => {
    /** The fixture tree: a PATH bin dir plus a bundle root carrying every stub. */
    const fx = buildFixture(root, { name: "all-present" })
    /** The doctor run against the fixture, with a fresh PATH/HOME. */
    const child = runChild(["--bundle-root", fx.bundle], fixtureEnv(fx))
    if (child.leak.length > 0) return armFail("hermeticity: the child names the real repo root " + child.leak.join(","), child)
    // Two entries cannot be fabricated as PRESENT on win32: no fixture can conjure a native
    // ast-grep, and a command script is refused by name (the adopted runner spawns with
    // shell:false), while comment-checker's plugin-owned order names its file literally, so a
    // stub there is unprobeable on win32 as well. Both are the platform's declared limit and
    // both must still be REPORTED - hence the per-platform expectation below.
    // git-bash joins them for a different reason: whether Git Bash exists is a property of the
    // HOST, not of the fixture, so the arm cannot demand it be ok - only that it is reported.
    /** Entries a win32 host cannot fabricate as present, so the arm asserts they are reported instead. */
    const win32Limited = ["ast-grep", "comment-checker", "git-bash"]
    /** The exit code this platform's fixture must produce. */
    const want = process.platform === "win32" ? EXIT.optionalMissing : EXIT.ok
    if (child.code !== want) return armFail("exit=" + child.code + " (want " + want + ")", child)
    /** Entries whose line is not the `ok` shape it must be on this platform. */
    const bad = ENTRY_SPECS.map((spec: EntrySpec): string => spec.id).filter((id: string): boolean => !(process.platform === "win32" && win32Limited.includes(id)) && !/\[(REQUIRED|OPTIONAL)\]: ok /.test(entryLine(child.stdout, id)))
    if (bad.length > 0) return armFail("entries not reported ok: " + bad.join(","), child)
    if (process.platform === "win32") {
      /** The fixture's toolchain bin dir, where the shim-shaped ast-grep stub sits. */
      const fixtureBin = join(fx.bundle, ".toolchain", "node_modules", ".bin")
      /** The ast-grep entry line, which must name the shim it refuses. */
      const refused = entryLine(child.stdout, "ast-grep")
      if (!refused.includes("MISSING ⇒ degrades: ") || !refused.includes("refused " + stubPath(fixtureBin, "ast-grep")) || !refused.includes("shell:false")) {
        return armFail("the fixture ast-grep shim is not refused BY NAME with its reason", child)
      }
      if (!entryLine(child.stdout, "comment-checker").includes("MISSING ⇒ degrades: ")) return armFail("the unprobeable comment-checker stub is not reported MISSING ⇒ degrades:", child)
      return { ok: true, detail: "win32: node/lsp/codegraph resolved, the shim-shaped ast-grep is refused BY NAME and the literal comment-checker stub is reported, exit 2" }
    }
    if (child.stdout.includes("MISSING")) return armFail("a MISSING line appeared in an all-present fixture", child)
    if (!/ast-grep \[OPTIONAL\]: ok path=.* version="ast-grep 9\.9\.9"/.test(entryLine(child.stdout, "ast-grep"))) return armFail("ast-grep version was not probed from the fixture stub", child)
    return { ok: true, detail: ENTRY_SPECS.length + "/" + ENTRY_SPECS.length + " entries ok, exit 0" }
  }],
  // Arm 2: a stale single-path pin is reported by name and never substituted.
  ["pin-nonexistent-astgrep", (root: string): ArmOutcome => {
    /** The fixture tree, whose ast-grep stub must NOT be used while the pin is in force. */
    const fx = buildFixture(root, { name: "pin-absent" })
    /** The pinned path, which does not exist. */
    const pin = join(fx.home, "absent", "sg")
    /** The doctor run with that pin exported. */
    const child = runChild(["--bundle-root", fx.bundle], fixtureEnv(fx, { MPD_AST_GREP_SG_PATH: pin }))
    if (child.leak.length > 0) return armFail("hermeticity: the child names the real repo root " + child.leak.join(","), child)
    if (child.code !== EXIT.optionalMissing) return armFail("exit=" + child.code + " (want " + EXIT.optionalMissing + ": the pin belongs to an OPTIONAL entry)", child)
    /** The ast-grep entry line the pin must be named on. */
    const line = entryLine(child.stdout, "ast-grep")
    if (!line.includes("MISSING ⇒ degrades: ")) return armFail("ast-grep line is not `MISSING ⇒ degrades:`", child)
    if (!line.includes(pin)) return armFail("the line does not name the pinned path " + pin, child)
    if (line.includes("9.9.9")) return armFail("a non-empty pin must win untouched, but the fixture stub leaked into the result", child)
    if (!/verdict=DEGRADED exit=2 rule="exit 2/.test(child.stdout)) return armFail("the verdict does not name the OPTIONAL rule", child)
    return { ok: true, detail: "ast-grep [OPTIONAL] MISSING ⇒ degrades with the pin named, no fallback used, exit 2" }
  }],
  // Arm 3: a missing REQUIRED row entrypoint yields exit 1, named as itself.
  ["missing-required-exit1", (root: string): ArmOutcome => {
    /** The fixture tree, whose LSP entrypoint is then overridden to a missing file. */
    const fx = buildFixture(root, { name: "required-absent" })
    /** The missing CLI the REQUIRED lsp row would be launched from. */
    const cli = join(fx.home, "absent", "cli.js")
    /** The doctor run with that override exported. */
    const child = runChild(["--bundle-root", fx.bundle], fixtureEnv(fx, { MPD_DSH_LSP_CLI: cli }))
    if (child.leak.length > 0) return armFail("hermeticity: the child names the real repo root " + child.leak.join(","), child)
    if (child.code !== EXIT.requiredMissing) return armFail("exit=" + child.code + " (want " + EXIT.requiredMissing + ": lsp is REQUIRED)", child)
    /** The lsp entry line the missing override must be named on. */
    const line = entryLine(child.stdout, "lsp")
    if (!line.includes("MISSING ⇒ degrades: ") || !line.includes(cli)) return armFail("the lsp line does not name the missing override", child)
    if (!/verdict=REQUIRED-MISSING exit=1 rule="exit 1/.test(child.stdout)) return armFail("the verdict does not name the REQUIRED rule", child)
    return { ok: true, detail: "lsp [REQUIRED] MISSING ⇒ degrades with the override named, exit 1" }
  }],
  // Arm 4: the two miss classes keep DISTINCT exit codes, each naming its rule.
  ["optional-degrade-exit2-distinct", (root: string): ArmOutcome => {
    /** The fixture tree with its codegraph stub omitted, so only an OPTIONAL entry is missing. */
    const fx = buildFixture(root, { name: "optional-absent", omit: ["codegraph"] })
    /** The run where only an OPTIONAL entry is missing. */
    const optionalOnly = runChild(["--bundle-root", fx.bundle], fixtureEnv(fx))
    /** The same fixture with a REQUIRED entry also broken, for the contrast. */
    const alsoRequired = runChild(["--bundle-root", fx.bundle], fixtureEnv(fx, { MPD_DSH_LSP_CLI: join(fx.home, "absent", "cli.js") }))
    if (optionalOnly.leak.length > 0) return armFail("hermeticity: the child names the real repo root " + optionalOnly.leak.join(","), optionalOnly)
    if (optionalOnly.code !== EXIT.optionalMissing) return armFail("optional-only miss: exit=" + optionalOnly.code + " (want " + EXIT.optionalMissing + ")", optionalOnly)
    if (alsoRequired.code !== EXIT.requiredMissing) return armFail("required miss: exit=" + alsoRequired.code + " (want " + EXIT.requiredMissing + ")", alsoRequired)
    /** The optional-only run's exit code widened to `number`, so the class contrast below stays a runtime check. */
    const optionalCode: number = optionalOnly.code
    /** The required-miss run's exit code widened the same way, for the same contrast. */
    const requiredCode: number = alsoRequired.code
    if (optionalCode === requiredCode) return armFail("the two classes share one exit code: " + optionalCode, optionalOnly)
    if (!entryLine(optionalOnly.stdout, "codegraph").includes("MISSING ⇒ degrades: ")) return armFail("the codegraph line is not MISSING ⇒ degrades:", optionalOnly)
    if (!/verdict=DEGRADED exit=2 rule="exit 2/.test(optionalOnly.stdout)) return armFail("the degrade run does not name the OPTIONAL rule", optionalOnly)
    if (!entryLine(optionalOnly.stdout, "node").includes(": ok ")) return armFail("a REQUIRED entry must stay ok when only OPTIONAL entries are missing", optionalOnly)
    return { ok: true, detail: "optional-only miss = exit 2, required miss = exit 1 (distinct codes, each naming its rule)" }
  }],
  // Arm 5: an absent OPTIONAL tool is reported as itself, and a foreign PATH look-alike is named.
  ["absent-ast-grep-named", (root: string): ArmOutcome => {
    /** The fixture tree with no ast-grep stub but a foreign `sg` on PATH. */
    const fx = buildFixture(root, { name: "absent-named", omit: ["ast-grep"], foreignSg: true })
    /** The doctor run against that fixture. */
    const child = runChild(["--bundle-root", fx.bundle], fixtureEnv(fx))
    if (child.leak.length > 0) return armFail("hermeticity: the child names the real repo root " + child.leak.join(","), child)
    if (child.code !== EXIT.optionalMissing) return armFail("exit=" + child.code + " (want " + EXIT.optionalMissing + ")", child)
    /** The ast-grep entry line, which absence must still produce. */
    const line = entryLine(child.stdout, "ast-grep")
    if (line.length === 0) return armFail("the absent ast-grep entry is not reported at all (absence must be reported as itself)", child)
    if (!line.includes("MISSING ⇒ degrades: ")) return armFail("the absent ast-grep is not reported as MISSING ⇒ degrades:", child)
    if (/\[OPTIONAL\]: ok /.test(line)) return armFail("the absent ast-grep was reported ok", child)
    if (!line.includes(join(fx.bin, "sg"))) return armFail("the foreign `sg` look-alike on PATH is not named as a rejected candidate", child)
    // Containment is asserted over the entries the FIXTURE builds. git-bash is a property of
    // the host (Git Bash installed or not) that no fixture can control, so it is asserted to be
    // REPORTED, not to be ok - and comment-checker's stub is unprobeable on win32.
    /** The entries the fixture fabricates, which the absent ast-grep must not disturb. */
    const mustBeOk = process.platform === "win32" ? ["node", "lsp", "codegraph"] : ["node", "lsp", "codegraph", "comment-checker"]
    for (const id of mustBeOk) {
      if (!/\[(REQUIRED|OPTIONAL)\]: ok /.test(entryLine(child.stdout, id))) return armFail("unrelated entry " + id + " was disturbed by the absent ast-grep", child)
    }
    /** The host-dependent git-bash line, which must be REPORTED either way. */
    const bashLine = entryLine(child.stdout, "git-bash")
    if (!(bashLine.includes(": ok ") || bashLine.includes("MISSING ⇒ degrades: "))) return armFail("the host-dependent git-bash entry was not reported at all", child)
    return { ok: true, detail: "absent ast-grep NAMED with its degrade sentence; the foreign `sg` was rejected, exit 2" }
  }],
  // Arm 6: a probe that never answers is MISSING-with-reason, contained to its own entry.
  ["hung-probe-is-missing", (root: string): ArmOutcome => {
    /** The fixture tree whose codegraph stub never answers `--version`. */
    const fx = buildFixture(root, { name: "hang-probe", hang: ["codegraph"] })
    /** The doctor run against that fixture. */
    const child = runChild(["--bundle-root", fx.bundle], fixtureEnv(fx))
    if (child.leak.length > 0) return armFail("hermeticity: the child names the real repo root " + child.leak.join(","), child)
    if (child.code !== EXIT.optionalMissing) return armFail("exit=" + child.code + " (want " + EXIT.optionalMissing + ")", child)
    /** The codegraph entry line, which the hung probe must have decided. */
    const line = entryLine(child.stdout, "codegraph")
    // The fixture stub must be the candidate that was probed: a mis-built fixture
    // has to fail HERE as a fixture-build error, never pass as an `ok`.
    /** The stub path the arm expects to see probed. */
    const stub = stubPath(join(fx.bundle, ".toolchain", "node_modules", ".bin"), "codegraph")
    if (!line.includes(stub)) return armFail("the arm did not probe the fixture stub " + stub, child)
    if (!line.includes("MISSING ⇒ degrades: ")) return armFail("a hung --version probe must report MISSING ⇒ degrades:", child)
    if (!/timeout after \d+ms/.test(line)) return armFail("the line does not name the probe timeout", child)
    /** The entries the hang must not leak into. */
    const mustStayOk = process.platform === "win32" ? ["node", "lsp"] : ["node", "ast-grep", "lsp", "comment-checker"]
    for (const id of mustStayOk) {
      if (!/\[(REQUIRED|OPTIONAL)\]: ok /.test(entryLine(child.stdout, id))) return armFail("the hung probe leaked into entry " + id, child)
    }
    return { ok: true, detail: "the fixture stub hung: MISSING-with-reason (timeout named, stub path named) and contained to its own entry, exit 2" }
  }],
  // Arm 7: `--json` carries one parseable payload with a record per entry.
  ["json-mode", (root: string): ArmOutcome => {
    /** The fixture tree every entry of which the payload must describe. */
    const fx = buildFixture(root, { name: "json-mode" })
    /** The doctor run in JSON mode. */
    const child = runChild(["--bundle-root", fx.bundle, "--json"], fixtureEnv(fx))
    if (child.leak.length > 0) return armFail("hermeticity: the child names the real repo root " + child.leak.join(","), child)
    /** The exit code this platform's fixture must produce in JSON mode too. */
    const want = process.platform === "win32" ? EXIT.optionalMissing : EXIT.ok
    if (child.code !== want) return armFail("exit=" + child.code + " (want " + want + ")", child)
    /** The prefixed JSON line, or undefined when the child printed none. */
    const line = child.stdout.split("\n").find((l: string): boolean => l.startsWith(PREFIXED_JSON))
    if (line === undefined) return armFail("no `" + PREFIXED_JSON + "{...}` line on stdout", child)
    /** The parsed payload; null until the parse below succeeds, because a stdout document is asserted. */
    let parsed: JsonPayload | null = null
    try { parsed = JSON.parse(line.slice(PREFIXED_JSON.length)) as JsonPayload } catch (error) { return armFail("the json line does not parse: " + oneLine(error instanceof Error ? error.message : String(error)), child) }
    if (parsed.verdict?.code !== want || parsed.entries?.length !== ENTRY_SPECS.length) return armFail("the payload carries verdict.code=" + parsed.verdict?.code + " and " + parsed.entries?.length + " entries", child)
    /** The entry records; the length assertion above already ruled out an absent array. */
    const records = parsed.entries ?? []
    if (!records.every((entry: JsonEntry): boolean => typeof entry.id === "string" && typeof entry.degrade === "string" && typeof entry.resolution === "string" && entry.envKeys !== undefined)) return armFail("an entry record is missing id/degrade/resolution/envKeys", child)
    return { ok: true, detail: "one prefixed JSON line, " + records.length + " entry records with degrade + resolution, exit 0" }
  }],
]

/** One entry record of the `--json` payload, as the shape its consumers read. */
interface JsonEntry {
  /** The entry id, which must be a string. */
  id?: unknown
  /** The degrade sentence, which must be a string. */
  degrade?: unknown
  /** The resolution prose, which must be a string. */
  resolution?: unknown
  /** The env keys, which must at least be present. */
  envKeys?: unknown
}

/** The `--json` payload as the json-mode arm asserts it: a stdout document, so every field is re-checked. */
interface JsonPayload {
  /** The verdict block, whose `code` must equal this platform's expected exit code. */
  verdict?: { code?: unknown }
  /** The entry records, one per row of the entry table. */
  entries?: JsonEntry[]
}

/**
 * Run every arm against one mkdtemp root and print the census.
 * @returns `EXIT.ok` when every arm passed, 1 when any arm failed
 */
function runSelfTest(): number {
  /** The self-test's own mkdtemp root, removed before this function returns. */
  const root = mkdtempSync(join(tmpdir(), "mpd-doctor-selftest-"))
  /** One verdict per arm, in run order, for the census. */
  const results: Array<{ name: string; ok: boolean; detail: string }> = []
  try {
    // Each arm is handed the same root and builds its own named fixture under it.
    for (const [name, run] of ARMS) {
      /** The arm's verdict, or its thrown failure folded into one. */
      let outcome: ArmOutcome
      try {
        outcome = run(root)
      } catch (error) {
        outcome = armFail("arm threw: " + oneLine(error instanceof Error ? error.message : String(error)), null)
      }
      results.push({ name, ok: outcome.ok, detail: outcome.detail })
      out("self-test arm=" + name + ": " + (outcome.ok ? "PASS" : "FAIL") + " (" + outcome.detail + ")")
      if (!outcome.ok && outcome.child) {
        for (const line of outcome.child.split("\n")) if (line.trim().length > 0) out("self-test arm=" + name + " child: " + line)
      }
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
  /** How many arms passed. */
  const passed = results.filter((result: { ok: boolean }): boolean => result.ok).length
  out("self-test census: arms=" + results.length + " passed=" + passed + " failed=" + (results.length - passed) + " fixture=" + root + " (mkdtemp; the real tree is never read)")
  if (passed !== results.length) {
    out("self-test FAIL: " + passed + "/" + results.length + " arms")
    return 1
  }
  out("self-test PASS: " + passed + "/" + results.length + " arms")
  return EXIT.ok
}

/** The parsed command line this process runs with. */
const args = parseArgs(process.argv.slice(2))
if (args.help) {
  usage()
  process.exit(EXIT.ok)
}
if (args.error.length > 0) {
  err(args.error)
  usage()
  process.exit(EXIT.usage)
}
if (args.selfTest) {
  process.exit(runSelfTest())
}
if (!statSync(args.bundleRoot, { throwIfNoEntry: false })?.isDirectory()) {
  err("--bundle-root " + args.bundleRoot + " is not an existing directory")
  process.exit(EXIT.usage)
}
/** The report of this run, printed as text or as the single JSON line. */
const report = doctor({ bundleRoot: args.bundleRoot, env: process.env, platform: process.platform })
emitReport(report, args)
process.exit(report.verdict.code)
