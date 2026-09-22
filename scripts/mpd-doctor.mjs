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
// Resolution sources: packages/mpd-mcp-shared/bin-resolve.mjs,
// packages/mpd-mcp-{astgrep,codegraph}/launch.mjs, packages/mpd-codegraph-plugin/src/index.ts,
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
// USAGE: node ./scripts/mpd-doctor.mjs [--json] [--bundle-root <dir>] [--help]
//        node ./scripts/mpd-doctor.mjs --self-test
//
// `--bundle-root <dir>` resolves every bundle-relative entry against <dir>
// instead of this checkout (packed/relocated installs; the self-test builds a
// temp fixture this way). It roots the bundle's node_modules lookups too, so a
// fixture cannot see the real tree.
import { execFileSync, spawnSync } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { delimiter, dirname, extname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { resolveAstGrepBinary, resolveCodegraphBinary } from "../packages/mpd-mcp-shared/bin-resolve.mjs"

const PREFIX = "[mpd-doctor]"
const SCRIPT_PATH = fileURLToPath(import.meta.url)
const DEFAULT_BUNDLE_ROOT = resolve(dirname(SCRIPT_PATH), "..")
const PROBE_TIMEOUT_MS = 10_000
const MAX_PROBE_OUTPUT = 200
const EXIT = { ok: 0, requiredMissing: 1, optionalMissing: 2, usage: 64 }
const RULE = {
  0: "exit 0 = every entry (REQUIRED and OPTIONAL) resolved",
  1: "exit 1 = at least one REQUIRED entry is missing (its row cannot start at all)",
  2: "exit 2 = no REQUIRED entry missing; only OPTIONAL entries are missing (degraded, not broken)",
  64: "exit 64 = usage error",
}

/** @param {string} line */
function out(line) { process.stdout.write(PREFIX + " " + line + "\n") }
/** @param {string} line */
function err(line) { process.stderr.write(PREFIX + " " + line + "\n") }

/** @param {unknown} value @returns {string|null} */
function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null
}

/** @param {unknown} text @param {number} [max] @returns {string} */
function oneLine(text, max = MAX_PROBE_OUTPUT) {
  const flat = String(text === undefined || text === null ? "" : text).replace(/\s+/g, " ").trim()
  return flat.length > max ? flat.slice(0, max) + "..." : flat
}

/**
 * Version probe with a hard timeout: a tool that answers nothing is reported
 * with its reason (or as MISSING where the resolver makes the probe the
 * acceptance rule), never left hanging and never fatal.
 * `fault` marks a probe that never RAN the tool (spawn failure, not executable,
 * exit 127 "command not found") - the file exists but cannot be executed.
 * @param {string} file @param {string[]} [args]
 * @returns {{ ok:boolean, out:string, reason:string, timedOut:boolean, fault:boolean }}
 */
function probe(file, args = ["--version"]) {
  // A candidate is not always directly executable: a `.cmd`/`.bat` needs the platform shell
  // (EINVAL without one) and a `.js` bin entry needs a runtime (EFTYPE without one). Both
  // shapes mirror the real consumers - `spawnChild` in scripts/dump-config.mjs and
  // `resolveServeProcessInvocation` in packages/mpd-mcp-codegraph/dist/serve.js - so the
  // reported version is the version the product itself would see.
  const commandScript = isCommandScript(file)
  const nodeScript = !commandScript && isNodeScript(file) && existsSync(file)
  const spawnFile = commandScript ? commandInterpreter() : nodeScript ? process.execPath : file
  const spawnArgs = commandScript ? ["/d", "/c", file, ...args] : nodeScript ? [file, ...args] : args
  try {
    const stdout = execFileSync(spawnFile, spawnArgs, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: PROBE_TIMEOUT_MS,
      killSignal: "SIGKILL",
      maxBuffer: 1024 * 1024,
    })
    return { ok: true, out: oneLine(stdout), reason: "", timedOut: false, fault: false }
  } catch (error) {
    const status = /** @type {{ status?:unknown }} */ (error)?.status
    return {
      ok: false,
      out: "",
      reason: probeFailureReason(error),
      timedOut: isTimeout(error),
      fault: typeof status !== "number" || status === 127,
    }
  }
}

/** @param {unknown} error @returns {boolean} */
function isTimeout(error) {
  const e = /** @type {{ code?:unknown, signal?:unknown }} */ (error)
  return Boolean(e) && (e.code === "ETIMEDOUT" || e.signal === "SIGKILL")
}

/** @param {unknown} error @returns {string} */
function probeFailureReason(error) {
  if (!error) return "unknown probe failure"
  const e = /** @type {{ code?:unknown, signal?:unknown, status?:unknown, message?:unknown }} */ (error)
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
 * @param {string} command @param {Record<string,string|undefined>} env @param {string} [platform]
 * @returns {string[]}
 */
function pathSpellings(command, env, platform = process.platform) {
  if (platform !== "win32") return [command]
  const declared = String(env.PATHEXT ?? "")
    .split(";")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0)
  const suffixes = declared.length > 0 ? declared : [".exe", ".com", ".cmd", ".bat"]
  return [...suffixes.map((suffix) => command + suffix), command]
}

/** @param {string} command @param {Record<string,string|undefined>} env @returns {string|null} */
function pathLookup(command, env) {
  const spellings = pathSpellings(command, env)
  for (const dir of String(env.PATH ?? "").split(delimiter)) {
    if (dir.length === 0) continue
    for (const spelling of spellings) {
      const candidate = join(dir, spelling)
      if (existsSync(candidate)) return candidate
    }
  }
  return null
}

/** @param {string} a @param {string} b @returns {boolean} */
function samePath(a, b) {
  try { return realpathSync(a) === realpathSync(b) } catch { return false }
}

/** @param {string} file @returns {{ version:string, source:string }|null} */
function packageVersionNear(file) {
  let dir
  try { dir = dirname(realpathSync(file)) } catch { dir = dirname(file) }
  // Three parents is enough for every layout here (package root, dist/, vendor/<key>/)
  // and stops the walk from reaching an unrelated manifest such as the repo root.
  for (let depth = 0; depth < 3; depth++) {
    const manifest = join(dir, "package.json")
    if (existsSync(manifest)) {
      try {
        const version = JSON.parse(readFileSync(manifest, "utf8")).version
        if (typeof version === "string" && version.length > 0) return { version, source: manifest }
      } catch { /* a broken manifest is not a version: keep walking up */ }
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

/**
 * Version of a resolved tool: the probe answer when there is one, else the
 * nearest package.json version, else "unknown" - always with its source named.
 * @param {string} file @param {{ ok:boolean, out:string, reason:string }} probed
 */
function versionOf(file, probed) {
  if (probed.ok && probed.out.length > 0) return { version: probed.out, versionSource: "`" + file + " --version`", probeReason: "" }
  const fallback = packageVersionNear(file)
  const why = probed.reason || "empty version output"
  if (fallback) return { version: fallback.version, versionSource: fallback.source + " (no --version answer: " + why + ")", probeReason: why }
  return { version: "unknown", versionSource: "no --version answer (" + why + ") and no package.json nearby", probeReason: why }
}

const NO_HANG_RULE = "a probe that never answers is treated as MISSING-with-reason (the no-hang rule), never as a silent ok"

/**
 * Publish a resolved path: `ok` with its version, unless the `--version` probe
 * HUNG - a tool that answers nothing is MISSING-with-reason, never a silent ok.
 * @param {string} path
 * @param {{ probed?:{ok:boolean,out:string,reason:string,timedOut:boolean}, via:string, rule:string, notes?:string[], checked?:string[] }} fields
 */
function acceptResolved(path, fields) {
  const probed = fields.probed ?? probe(path)
  if (probed.timedOut) {
    return result("missing", { ...fields, path: null, reason: "`" + path + " --version` " + probed.reason, rule: fields.rule + " (no-hang rule: " + NO_HANG_RULE + ")" })
  }
  if (probed.fault) {
    return result("missing", { ...fields, path: null, reason: "`" + path + " --version` cannot run the tool: " + probed.reason, rule: fields.rule + " (a present-but-unexecutable file is a fault, not a missing version flag)" })
  }
  return result("ok", { ...fields, path, ...versionOf(path, probed) })
}

/** @param {string} bundleRoot */
function bundleRequireResolve(bundleRoot) {
  const requireFromBundle = createRequire(join(bundleRoot, "package.json"))
  return (spec) => requireFromBundle.resolve(spec)
}

/**
 * The adopted ast-grep server's LAST resort when the MPD launcher leaves the env
 * unset: its own chain tries PATH (`ast-grep`, then `sg`) with the same
 * `--version` "ast-grep" acceptance. Reported as a fallback, never as a tier of
 * the MPD resolver.
 * @param {Record<string,string|undefined>} env
 */
function astGrepPathFallback(env) {
  const rejected = []
  for (const name of ["ast-grep", "sg"]) {
    const candidate = pathLookup(name, env)
    if (candidate === null) continue
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
 * @returns {string}
 */
function commandInterpreter() {
  const comspec = nonEmpty(process.env.ComSpec)
  if (comspec !== null) return comspec
  const systemRoot = nonEmpty(process.env.SystemRoot) ?? nonEmpty(process.env.windir)
  if (systemRoot !== null) return join(systemRoot, "System32", "cmd.exe")
  return "C:\\Windows\\System32\\cmd.exe"
}

/**
 * Why the adopted ast-grep runner cannot start this path, in the shape of the file.
 * @param {string} path @returns {string}
 */
function spawnShapeReason(path) {
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
 * @param {{ env:Record<string,string|undefined>, bundleRoot:string }} ctx @returns {string[]}
 */
function astGrepShimNotes(ctx) {
  const notes = []
  const dirs = [
    nonEmpty(ctx.env.MPD_AST_GREP_BIN_DIR),
    join(ctx.bundleRoot, ".toolchain", "node_modules", ".bin"),
    join(ctx.bundleRoot, "node_modules", ".bin"),
  ]
  for (const dir of dirs) {
    if (dir === null) continue
    for (const name of ["ast-grep", "sg"]) {
      for (const spelling of pathSpellings(name, ctx.env)) {
        const candidate = join(dir, spelling)
        if (!existsSync(candidate) || astGrepDirectlySpawnable(candidate)) continue
        notes.push("refused " + candidate + ": " + spawnShapeReason(candidate) + " - install the native ast-grep.exe or point MPD_AST_GREP_SG_PATH at one")
      }
    }
  }
  return notes
}

/** @param {"ok"|"missing"|"not-required"} status */
function result(status, fields) {
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

const ENTRY_SPECS = [
  {
    id: "node",
    kind: "runtime",
    required: true,
    envKeys: [],
    resolution: "PATH lookup `node` (the interpreter every MCP row's `command: node` resolves) -> this doctor's own process.execPath",
    degrade: "no node on PATH: every `command: node` MCP row (ast_grep, lsp, codegraph) and every repo gate fails to spawn",
    resolve(ctx) {
      const onPath = pathLookup("node", ctx.env)
      const path = onPath ?? process.execPath
      const probed = probe(path)
      const notes = []
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
    resolution: "MPD_AST_GREP_SG_PATH pin (a non-empty pin wins untouched in launch.mjs) -> $MPD_AST_GREP_BIN_DIR/{ast-grep,sg} -> createRequire(@ast-grep/cli) package bin -> <bundle>/.toolchain/node_modules/.bin/{ast-grep,sg}; every candidate must pass the `--version` probe whose output contains \"ast-grep\" (the deprecated `sg` wrapper fails it); the MPD resolver has NO PATH tier",
    degrade: "the ast_grep MCP exposes no tools (mcp__ast_grep__search / mcp__ast_grep__scan / mcp__ast_grep__rewrite unavailable): dist/cli.js answers BINARY_NOT_FOUND - \"no candidate passed the --version probe across the env override, MPD runtime, skill bin cache, PATH, or Homebrew prefixes\"",
    resolve(ctx) {
      const checked = []
      const notes = []
      const fallback = astGrepPathFallback(ctx.env)
      notes.push("adopted-chain PATH fallback: " + (fallback.path ? "accepts " + fallback.path : "nothing accepted" + (fallback.rejected.length ? " (rejected: " + fallback.rejected.join(" ; ") + ")" : " (no ast-grep/sg on PATH)")))
      notes.push("scope: the adopted server's MPD-runtime, skill-bin-cache and Homebrew tiers are not probed by this doctor")

      const pin = nonEmpty(ctx.env.MPD_AST_GREP_SG_PATH)
      if (pin !== null) {
        checked.push("env pin MPD_AST_GREP_SG_PATH=" + pin + " (" + (existsSync(pin) ? "present" : "MISSING") + ")")
        if (!existsSync(pin)) {
          return result("missing", {
            rule: "a non-empty MPD_AST_GREP_SG_PATH wins untouched in launch.mjs (no MPD-side substitution)",
            reason: "MPD_AST_GREP_SG_PATH=" + pin + " is set and does not exist",
            degradeSuffix: fallback.path ? " - the pin is stale rather than fatal: the adopted chain's own PATH fallback would accept " + fallback.path + ", so fix or unset the pin" : "",
            notes,
            checked,
          })
        }
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

      const binDir = nonEmpty(ctx.env.MPD_AST_GREP_BIN_DIR)
      checked.push("$MPD_AST_GREP_BIN_DIR=" + (binDir ?? "<unset>") + "/{ast-grep,sg}")
      checked.push("createRequire(@ast-grep/cli/package.json) rooted at " + ctx.bundleRoot)
      const toolchainPair = join(ctx.bundleRoot, ".toolchain", "node_modules", ".bin")
      checked.push(toolchainPair + "/{ast-grep,sg}")
      const resolved = resolveAstGrepBinary(join(ctx.bundleRoot, "scripts", "mpd-doctor.mjs"), {
        env: ctx.env,
        bundleRoot: ctx.bundleRoot,
        requireResolve: bundleRequireResolve(ctx.bundleRoot),
      })
      if (resolved !== null) {
        const siblingSg = join(toolchainPair, "sg")
        if (existsSync(siblingSg) && !samePath(siblingSg, resolved.binary)) notes.push("rejected sibling candidate " + siblingSg + ": the deprecated `sg` wrapper exits 1 under `--version`")
        return acceptResolved(resolved.binary, {
          via: "MPD resolver source=" + resolved.source,
          rule: "env pin unset: packages/mpd-mcp-shared/bin-resolve.mjs owns the order (BIN_DIR -> require -> .toolchain)",
          notes,
          checked,
        })
      }
      if (fallback.path !== null) {
        return acceptResolved(fallback.path, {
          via: "adopted-chain PATH fallback (the MPD launcher left MPD_AST_GREP_SG_PATH unset, so dist/cli.js runs its own chain)",
          rule: "the MPD resolver yields nothing, but the adopted chain accepts this PATH candidate",
          notes: notes.concat(["the MPD resolver found nothing: run `node ./scripts/install-mcp.mjs` or set $MPD_AST_GREP_BIN_DIR"]),
          checked,
        })
      }
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
    resolve(ctx) {
      const checked = []
      const notes = []
      const primary = nonEmpty(ctx.env.MPD_CODEGRAPH_BIN)
      const pin = primary ?? nonEmpty(ctx.env.MPD_DSH_CODEGRAPH_BIN)
      const pinKey = primary !== null ? "MPD_CODEGRAPH_BIN" : "MPD_DSH_CODEGRAPH_BIN"
      const resolved = resolveCodegraphBinary(join(ctx.bundleRoot, "packages", "mpd-codegraph-plugin", "launch.mjs"), {
        env: ctx.env,
        bundleRoot: ctx.bundleRoot,
        requireResolve: bundleRequireResolve(ctx.bundleRoot),
      })
      const onPath = pathLookup("codegraph", ctx.env)
      const fallback = resolved !== null ? resolved.binary : onPath
      checked.push(pin === null ? "env pin MPD_CODEGRAPH_BIN/MPD_DSH_CODEGRAPH_BIN: unset" : "env pin " + pinKey + "=" + pin + " (" + (existsSync(pin) ? "present" : "MISSING") + ")")
      checked.push("createRequire(@colbymchenry/codegraph/package.json) rooted at " + ctx.bundleRoot + " (bin entry, else bin/codegraph.js, else npm-shim.js)")
      checked.push(join(ctx.bundleRoot, ".toolchain", "node_modules", ".bin", "codegraph"))
      checked.push("PATH codegraph" + (onPath === null ? " (none)" : "=" + onPath))

      if (pin !== null && !existsSync(pin)) {
        return result("missing", {
          rule: "a non-empty " + pinKey + " pin wins untouched in launch.mjs, so the MCP child takes source \"env\" and skips provisioning (zero tools, alive, exit 0)",
          reason: pinKey + "=" + pin + " is set and does not exist",
          degradeSuffix: fallback !== null ? " - the mpd-codegraph PLUGIN row falls through to " + fallback + ", but the MCP child keeps the bad pin" : " - the plugin row finds no fallback either",
          notes,
          checked,
        })
      }
      if (pin !== null) {
        return acceptResolved(pin, { via: "env pin " + pinKey, rule: "a non-empty pin wins untouched in launch.mjs", notes, checked })
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
        notes: notes.concat(["`node ./scripts/install-mcp.mjs` installs the codegraph toolchain"]),
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
    resolve(ctx) {
      const override = nonEmpty(ctx.env.MPD_DSH_LSP_CLI)
      const bundled = join(ctx.bundleRoot, "packages", "mpd-mcp-lsp", "dist", "cli.js")
      const path = override ?? bundled
      const via = override !== null ? "env override MPD_DSH_LSP_CLI" : "bundle-shipped row entrypoint"
      if (!existsSync(path) || !isFile(path)) {
        return result("missing", {
          rule: "a REQUIRED row entrypoint has no fallback: the launcher is `node <file> mcp` and nothing substitutes a missing file",
          reason: override !== null ? "MPD_DSH_LSP_CLI=" + override + " is set and is not a file" : "the bundle-shipped CLI " + bundled + " is missing",
          checked: [override !== null ? "env override MPD_DSH_LSP_CLI=" + override : "env override MPD_DSH_LSP_CLI: unset", bundled],
        })
      }
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
    resolve(ctx) {
      const override = nonEmpty(ctx.env.MPD_DSH_GITBASH_CLI)
      const bundled = join(ctx.bundleRoot, "packages", "mpd-mcp-gitbash", "dist", "cli.js")
      const cli = override ?? bundled
      const checked = [override !== null ? "env override MPD_DSH_GITBASH_CLI=" + override : "env override MPD_DSH_GITBASH_CLI: unset", "row entrypoint " + cli + " (" + (isFile(cli) ? "present" : "MISSING") + ")"]
      if (ctx.platform !== "win32") {
        return result("not-required", {
          via: "resolveGitBash(): platform !== win32 -> { found: true, path: null, source: \"not-required\" }",
          rule: "the git_bash MCP answers \"disabled: git_bash command execution is only exposed on native Windows\", and the bundle row itself is `disabled: true`",
          notes: [isFile(cli) ? "the disabled row's entrypoint is present at " + cli : "the resolved row entrypoint " + cli + " is missing; enable the row only after fixing that"],
          checked,
        })
      }
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
    degrade: "mpd_comment_check is unavailable (the opt-in detector is not installed): run `node ./scripts/install-mcp.mjs --with-comment-checker` or set MPD_DSH_COMMENT_CHECKER_BIN; comment/docstring detection degrades to a tool error",
    resolve(ctx) {
      const override = nonEmpty(ctx.env.MPD_DSH_COMMENT_CHECKER_BIN)
      const key = process.platform + "-" + (process.arch === "x64" ? "x64" : process.arch)
      const toolchainRoot = join(ctx.bundleRoot, ".toolchain", "node_modules", "@code-yeongyu", "comment-checker")
      const checked = ["env override MPD_DSH_COMMENT_CHECKER_BIN: " + (override ?? "unset"), "createRequire(@code-yeongyu/comment-checker/package.json) rooted at " + ctx.bundleRoot, join(toolchainRoot, "vendor", key, "comment-checker"), join(toolchainRoot, "bin", "comment-checker")]
      let dependency = null
      try {
        const manifest = bundleRequireResolve(ctx.bundleRoot)("@code-yeongyu/comment-checker/package.json")
        dependency = join(dirname(manifest), "vendor", key, "comment-checker")
      } catch { /* not resolvable from this bundle root: the env override and .toolchain tiers remain */ }
      const candidates = [override, dependency, join(toolchainRoot, "vendor", key, "comment-checker"), join(toolchainRoot, "bin", "comment-checker")].filter((candidate) => candidate !== null && existsSync(candidate))
      const path = candidates[0] ?? null
      if (path === null) {
        return result("missing", { rule: "env override -> resolvable package vendor binary -> <bundle>/.toolchain vendor/bin (no PATH tier in the plugin resolver)", reason: "no candidate resolved for platform key " + key, checked })
      }
      const probed = probe(path)
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
 * @param {string} path @returns {boolean}
 */
function isCommandScript(path) {
  if (process.platform !== "win32") return false
  const extension = extname(path).toLowerCase()
  return extension === ".cmd" || extension === ".bat"
}

/**
 * A `bin` entry that is a node script. The adopters run one through the runtime rather than
 * exec it (measured 2026-09-22: `execFileSync` on `npm-shim.js` answers EFTYPE); the mirror
 * is `resolveServeProcessInvocation` in packages/mpd-mcp-codegraph/dist/serve.js.
 * @param {string} path @returns {boolean}
 */
function isNodeScript(path) {
  return /\.[cm]?js$/i.test(path)
}

/**
 * Can the ADOPTED ast-grep runner start this path directly? It spawns with `shell: false`,
 * so win32 accepts an executable image only: an npm `.cmd` shim has no shell and a node shim
 * has no runtime (measured: EINVAL / EFTYPE). A candidate that fails this is still REPORTED -
 * as refused, by name - never silently dropped.
 * @param {string} path @returns {boolean}
 */
function astGrepDirectlySpawnable(path) {
  if (process.platform !== "win32") return true
  const extension = extname(path).toLowerCase()
  return extension === ".exe" || extension === ".com"
}

/** @param {string} path @returns {boolean} */
function isFile(path) {
  try { return statSync(path).isFile() } catch { return false }
}

/** Windows-only Git Bash resolution, mirroring packages/mpd-mcp-gitbash/dist/cli.js. */
function resolveWindowsBash(env) {
  const checked = []
  for (const [candidate, source] of [["C:\\Program Files\\Git\\bin\\bash.exe", "program-files"], ["C:\\Program Files (x86)\\Git\\bin\\bash.exe", "program-files-x86"]]) {
    checked.push(candidate + " (" + (isFile(candidate) ? "present" : "MISSING") + ")")
    if (isFile(candidate)) return { path: candidate, source, checked }
  }
  let whereOutput = ""
  try { whereOutput = execFileSync("where", ["bash"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: PROBE_TIMEOUT_MS }) } catch { whereOutput = "" }
  for (const raw of whereOutput.split(/\r?\n/)) {
    const candidate = raw.trim()
    if (candidate.length === 0) continue
    checked.push("where bash -> " + candidate)
    const normalized = candidate.replaceAll("/", "\\").toLowerCase()
    if (normalized.includes("\\windows\\system32\\") || normalized.includes("\\microsoft\\windowsapps\\")) continue
    if (candidate.toLowerCase().endsWith("bash.exe") && isFile(candidate)) return { path: candidate, source: "path", checked }
  }
  return { path: null, source: "missing", checked }
}

/** @param {{ bundleRoot:string, env:Record<string,string|undefined>, platform:string }} ctx */
function doctor(ctx) {
  const entries = ENTRY_SPECS.map((spec) => {
    let raw
    try {
      raw = spec.resolve(ctx)
    } catch (error) {
      raw = result("missing", {
        rule: "an entry resolver must never throw; a throw is reported as MISSING-with-reason",
        reason: "resolution threw: " + oneLine(error && error.message ? error.message : String(error)),
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
  const missing = entries.filter((entry) => entry.status === "missing")
  const missingRequired = missing.filter((entry) => entry.required)
  const missingOptional = missing.filter((entry) => !entry.required)
  const code = missingRequired.length > 0 ? EXIT.requiredMissing : missingOptional.length > 0 ? EXIT.optionalMissing : EXIT.ok
  const name = code === EXIT.ok ? "OK" : code === EXIT.requiredMissing ? "REQUIRED-MISSING" : "DEGRADED"
  return {
    bundleRoot: ctx.bundleRoot,
    platform: ctx.platform,
    entries,
    verdict: {
      code,
      name,
      rule: RULE[code],
      missingRequired: missingRequired.map((entry) => entry.id),
      missingOptional: missingOptional.map((entry) => entry.id),
    },
  }
}

/** @param {ReturnType<typeof doctor>} report @param {{ json:boolean }} args */
function emitReport(report, args) {
  if (args.json) {
    out("json " + JSON.stringify({ schema: "mpd-doctor/1", probeTimeoutMs: PROBE_TIMEOUT_MS, exitRule: RULE, ...report }))
    return
  }
  const required = report.entries.filter((entry) => entry.required).length
  out("toolchain doctor: " + report.entries.length + " entries (" + required + " REQUIRED / " + (report.entries.length - required) + " OPTIONAL), bundle-root=" + report.bundleRoot)
  out("platform=" + report.platform + "-" + process.arch + ", node " + process.version + ", probe timeout=" + PROBE_TIMEOUT_MS + "ms per `--version` probe")
  out("exit rule: 0 = every entry resolved; 1 = a REQUIRED entry is missing; 2 = only OPTIONAL entries are missing")
  for (const entry of report.entries) {
    out("plan " + entry.id + " [" + (entry.required ? "REQUIRED" : "OPTIONAL") + "] env=" + (entry.envKeys.length > 0 ? entry.envKeys.join(",") : "none") + " order=\"" + entry.resolution + "\"")
  }
  for (const entry of report.entries) out(formatEntry(entry))
  const detail = [
    report.verdict.missingRequired.length > 0 ? "missingREQUIRED=" + report.verdict.missingRequired.join(",") : "required=all-present",
    report.verdict.missingOptional.length > 0 ? "missingOPTIONAL=" + report.verdict.missingOptional.join(",") : "",
  ].filter((part) => part.length > 0).join(" ")
  out("verdict=" + report.verdict.name + " exit=" + report.verdict.code + " rule=\"" + report.verdict.rule + "\"" + (detail.length > 0 ? " " + detail : ""))
  if (report.verdict.code !== EXIT.ok) {
    out("remedy: node ./scripts/install-mcp.mjs (toolchain binaries) | re-check: node ./scripts/mpd-doctor.mjs")
  }
}

/** @param {ReturnType<typeof doctor>["entries"][number]} entry */
function formatEntry(entry) {
  const cls = entry.required ? "REQUIRED" : "OPTIONAL"
  const env = "env=" + (entry.envKeys.length > 0 ? entry.envKeys.join(",") : "none")
  const notes = entry.notes.length > 0 ? " | note: " + entry.notes.join(" ; ") : ""
  const checked = entry.checked.length > 0 ? " | checked: " + entry.checked.join(" ; ") : ""
  if (entry.status === "missing") {
    return entry.id + " [" + cls + "]: MISSING ⇒ degrades: " + entry.degrade + " | rule: " + entry.rule + " | reason: " + entry.reason + checked + notes + " | " + env
  }
  if (entry.status === "not-required") {
    return entry.id + " [" + cls + "]: ok (not-required on " + process.platform + ") ⇒ degrades: " + entry.degrade + " | rule: " + entry.rule + " | via: " + entry.via + checked + notes + " | " + env
  }
  return entry.id + " [" + cls + "]: ok path=" + entry.path + " version=\"" + entry.version + "\" version-source=" + entry.versionSource + " via=" + entry.via + (entry.probeReason ? " probe=" + entry.probeReason : "") + checked + notes + " | " + env
}

function usage() {
  out("usage: node ./scripts/mpd-doctor.mjs [--json] [--bundle-root <dir>] [--help]")
  out("       node ./scripts/mpd-doctor.mjs --self-test")
  out("  --json                 one prefixed JSON line: `" + PREFIX + " json {...}` (the payload follows the marker)")
  out("  --bundle-root <dir>    resolve bundle-relative entries against <dir> instead of this checkout (must be an existing directory)")
  out("  --self-test            hermetic arms on a temp fixture (mkdtemp): never the real repo state")
  out("exit codes: 0 = every entry resolved; 1 = a REQUIRED entry is missing; 2 = only OPTIONAL entries are missing; " + EXIT.usage + " = usage error")
}

/** @param {string[]} argv */
function parseArgs(argv) {
  const parsed = { selfTest: false, json: false, help: false, bundleRoot: DEFAULT_BUNDLE_ROOT, error: "" }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--self-test") parsed.selfTest = true
    else if (arg === "--json") parsed.json = true
    else if (arg === "--help" || arg === "-h") parsed.help = true
    else if (arg === "--bundle-root") {
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

const PREFIXED_JSON = PREFIX + " json "

/** @param {string} root @param {{ name:string, omit?:string[], hang?:string[], foreignSg?:boolean, pathAstGrep?:boolean }} options */
function buildFixture(root, options) {
  const home = join(root, options.name)
  const bin = join(home, "bin")
  const bundle = join(home, "bundle")
  const omit = new Set(options.omit ?? [])
  const hang = new Set(options.hang ?? [])
  mkdirSync(bin, { recursive: true })
  mkdirSync(bundle, { recursive: true })
  writeFileSync(join(bundle, "package.json"), JSON.stringify({ name: "mpd-doctor-fixture", version: "0.0.0" }) + "\n")
  try { symlinkSync(process.execPath, join(bin, "node")) } catch { /* a fixture without a PATH node is reported by the node entry, never fatal */ }
  const binDir = join(bundle, ".toolchain", "node_modules", ".bin")
  const stubs = [
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
 * @param {string} name @returns {string}
 */
function stubName(name) { return process.platform === "win32" ? name + ".cmd" : name }

/** @param {string} dir @param {string} name @returns {string} */
function stubPath(dir, name) { return join(dir, stubName(name)) }

/** @param {string} text @returns {string} */
function versionStub(text) {
  return process.platform === "win32" ? "@echo off\r\necho " + text + "\r\n" : "#!/bin/sh\necho \"" + text + "\"\n"
}

/**
 * A stub that never answers `--version`. On win32 the wait must burn INSIDE the one process the
 * probe kills: a `ping`/`timeout` child would hold the pipe after the kill, so the arm would
 * measure a lingering grandchild instead of the no-hang rule.
 * @returns {string}
 */
function hangStub() {
  return process.platform === "win32" ? "@echo off\r\n:loop\r\ngoto loop\r\n" : "#!/bin/sh\nexec /bin/sleep 30\n"
}

/** @param {string} file @param {string} body */
function writeStub(file, body) {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, body)
  chmodSync(file, 0o755)
}

/** @param {{ home:string, bin:string }} fixture @param {Record<string,string>} [extra] */
function fixtureEnv(fixture, extra = {}) {
  // A fresh PATH/HOME only: no MPD_* variable of the caller survives into an arm.
  return { PATH: fixture.bin, HOME: fixture.home, LANG: "C", NO_COLOR: "1", ...extra }
}

/** @param {string[]} args @param {Record<string,string>} env */
function runChild(args, env) {
  const spawned = spawnSync(process.execPath, [SCRIPT_PATH, ...args], { env, encoding: "utf8", timeout: 120_000, stdio: ["ignore", "pipe", "pipe"] })
  const stdout = spawned.stdout ?? ""
  const stderr = spawned.stderr ?? ""
  return {
    code: spawned.status,
    stdout,
    stderr,
    detail: spawned.error ? oneLine(spawned.error.message) : "",
    leak: [DEFAULT_BUNDLE_ROOT, join(DEFAULT_BUNDLE_ROOT, "node_modules")].filter((path) => (stdout + stderr).includes(path)),
  }
}

/** @param {string} text @param {string} id */
function entryLine(text, id) {
  return text.split("\n").find((line) => line.startsWith(PREFIX + " " + id + " [")) ?? ""
}

/** @param {string} detail @param {{ stdout:string, stderr:string }|null} child */
function armFail(detail, child) {
  return { ok: false, detail, child: child ? child.stdout + child.stderr : "" }
}

const ARMS = [
  ["all-present-fixture", (root) => {
    const fx = buildFixture(root, { name: "all-present" })
    const child = runChild(["--bundle-root", fx.bundle], fixtureEnv(fx))
    if (child.leak.length > 0) return armFail("hermeticity: the child names the real repo root " + child.leak.join(","), child)
    // Two entries cannot be fabricated as PRESENT on win32: no fixture can conjure a native
    // ast-grep, and a command script is refused by name (the adopted runner spawns with
    // shell:false), while comment-checker's plugin-owned order names its file literally, so a
    // stub there is unprobeable on win32 as well. Both are the platform's declared limit and
    // both must still be REPORTED - hence the per-platform expectation below.
    // git-bash joins them for a different reason: whether Git Bash exists is a property of the
    // HOST, not of the fixture, so the arm cannot demand it be ok - only that it is reported.
    const win32Limited = ["ast-grep", "comment-checker", "git-bash"]
    const want = process.platform === "win32" ? EXIT.optionalMissing : EXIT.ok
    if (child.code !== want) return armFail("exit=" + child.code + " (want " + want + ")", child)
    const bad = ENTRY_SPECS.map((spec) => spec.id).filter((id) => !(process.platform === "win32" && win32Limited.includes(id)) && !/\[(REQUIRED|OPTIONAL)\]: ok /.test(entryLine(child.stdout, id)))
    if (bad.length > 0) return armFail("entries not reported ok: " + bad.join(","), child)
    if (process.platform === "win32") {
      const fixtureBin = join(fx.bundle, ".toolchain", "node_modules", ".bin")
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
  ["pin-nonexistent-astgrep", (root) => {
    const fx = buildFixture(root, { name: "pin-absent" })
    const pin = join(fx.home, "absent", "sg")
    const child = runChild(["--bundle-root", fx.bundle], fixtureEnv(fx, { MPD_AST_GREP_SG_PATH: pin }))
    if (child.leak.length > 0) return armFail("hermeticity: the child names the real repo root " + child.leak.join(","), child)
    if (child.code !== EXIT.optionalMissing) return armFail("exit=" + child.code + " (want " + EXIT.optionalMissing + ": the pin belongs to an OPTIONAL entry)", child)
    const line = entryLine(child.stdout, "ast-grep")
    if (!line.includes("MISSING ⇒ degrades: ")) return armFail("ast-grep line is not `MISSING ⇒ degrades:`", child)
    if (!line.includes(pin)) return armFail("the line does not name the pinned path " + pin, child)
    if (line.includes("9.9.9")) return armFail("a non-empty pin must win untouched, but the fixture stub leaked into the result", child)
    if (!/verdict=DEGRADED exit=2 rule="exit 2/.test(child.stdout)) return armFail("the verdict does not name the OPTIONAL rule", child)
    return { ok: true, detail: "ast-grep [OPTIONAL] MISSING ⇒ degrades with the pin named, no fallback used, exit 2" }
  }],
  ["missing-required-exit1", (root) => {
    const fx = buildFixture(root, { name: "required-absent" })
    const cli = join(fx.home, "absent", "cli.js")
    const child = runChild(["--bundle-root", fx.bundle], fixtureEnv(fx, { MPD_DSH_LSP_CLI: cli }))
    if (child.leak.length > 0) return armFail("hermeticity: the child names the real repo root " + child.leak.join(","), child)
    if (child.code !== EXIT.requiredMissing) return armFail("exit=" + child.code + " (want " + EXIT.requiredMissing + ": lsp is REQUIRED)", child)
    const line = entryLine(child.stdout, "lsp")
    if (!line.includes("MISSING ⇒ degrades: ") || !line.includes(cli)) return armFail("the lsp line does not name the missing override", child)
    if (!/verdict=REQUIRED-MISSING exit=1 rule="exit 1/.test(child.stdout)) return armFail("the verdict does not name the REQUIRED rule", child)
    return { ok: true, detail: "lsp [REQUIRED] MISSING ⇒ degrades with the override named, exit 1" }
  }],
  ["optional-degrade-exit2-distinct", (root) => {
    const fx = buildFixture(root, { name: "optional-absent", omit: ["codegraph"] })
    const optionalOnly = runChild(["--bundle-root", fx.bundle], fixtureEnv(fx))
    const alsoRequired = runChild(["--bundle-root", fx.bundle], fixtureEnv(fx, { MPD_DSH_LSP_CLI: join(fx.home, "absent", "cli.js") }))
    if (optionalOnly.leak.length > 0) return armFail("hermeticity: the child names the real repo root " + optionalOnly.leak.join(","), optionalOnly)
    if (optionalOnly.code !== EXIT.optionalMissing) return armFail("optional-only miss: exit=" + optionalOnly.code + " (want " + EXIT.optionalMissing + ")", optionalOnly)
    if (alsoRequired.code !== EXIT.requiredMissing) return armFail("required miss: exit=" + alsoRequired.code + " (want " + EXIT.requiredMissing + ")", alsoRequired)
    if (optionalOnly.code === alsoRequired.code) return armFail("the two classes share one exit code: " + optionalOnly.code, optionalOnly)
    if (!entryLine(optionalOnly.stdout, "codegraph").includes("MISSING ⇒ degrades: ")) return armFail("the codegraph line is not MISSING ⇒ degrades:", optionalOnly)
    if (!/verdict=DEGRADED exit=2 rule="exit 2/.test(optionalOnly.stdout)) return armFail("the degrade run does not name the OPTIONAL rule", optionalOnly)
    if (!entryLine(optionalOnly.stdout, "node").includes(": ok ")) return armFail("a REQUIRED entry must stay ok when only OPTIONAL entries are missing", optionalOnly)
    return { ok: true, detail: "optional-only miss = exit 2, required miss = exit 1 (distinct codes, each naming its rule)" }
  }],
  ["absent-ast-grep-named", (root) => {
    const fx = buildFixture(root, { name: "absent-named", omit: ["ast-grep"], foreignSg: true })
    const child = runChild(["--bundle-root", fx.bundle], fixtureEnv(fx))
    if (child.leak.length > 0) return armFail("hermeticity: the child names the real repo root " + child.leak.join(","), child)
    if (child.code !== EXIT.optionalMissing) return armFail("exit=" + child.code + " (want " + EXIT.optionalMissing + ")", child)
    const line = entryLine(child.stdout, "ast-grep")
    if (line.length === 0) return armFail("the absent ast-grep entry is not reported at all (absence must be reported as itself)", child)
    if (!line.includes("MISSING ⇒ degrades: ")) return armFail("the absent ast-grep is not reported as MISSING ⇒ degrades:", child)
    if (/\[OPTIONAL\]: ok /.test(line)) return armFail("the absent ast-grep was reported ok", child)
    if (!line.includes(join(fx.bin, "sg"))) return armFail("the foreign `sg` look-alike on PATH is not named as a rejected candidate", child)
    // Containment is asserted over the entries the FIXTURE builds. git-bash is a property of
    // the host (Git Bash installed or not) that no fixture can control, so it is asserted to be
    // REPORTED, not to be ok - and comment-checker's stub is unprobeable on win32.
    const mustBeOk = process.platform === "win32" ? ["node", "lsp", "codegraph"] : ["node", "lsp", "codegraph", "comment-checker"]
    for (const id of mustBeOk) {
      if (!/\[(REQUIRED|OPTIONAL)\]: ok /.test(entryLine(child.stdout, id))) return armFail("unrelated entry " + id + " was disturbed by the absent ast-grep", child)
    }
    const bashLine = entryLine(child.stdout, "git-bash")
    if (!(bashLine.includes(": ok ") || bashLine.includes("MISSING ⇒ degrades: "))) return armFail("the host-dependent git-bash entry was not reported at all", child)
    return { ok: true, detail: "absent ast-grep NAMED with its degrade sentence; the foreign `sg` was rejected, exit 2" }
  }],
  ["hung-probe-is-missing", (root) => {
    const fx = buildFixture(root, { name: "hang-probe", hang: ["codegraph"] })
    const child = runChild(["--bundle-root", fx.bundle], fixtureEnv(fx))
    if (child.leak.length > 0) return armFail("hermeticity: the child names the real repo root " + child.leak.join(","), child)
    if (child.code !== EXIT.optionalMissing) return armFail("exit=" + child.code + " (want " + EXIT.optionalMissing + ")", child)
    const line = entryLine(child.stdout, "codegraph")
    // The fixture stub must be the candidate that was probed: a mis-built fixture
    // has to fail HERE as a fixture-build error, never pass as an `ok`.
    const stub = stubPath(join(fx.bundle, ".toolchain", "node_modules", ".bin"), "codegraph")
    if (!line.includes(stub)) return armFail("the arm did not probe the fixture stub " + stub, child)
    if (!line.includes("MISSING ⇒ degrades: ")) return armFail("a hung --version probe must report MISSING ⇒ degrades:", child)
    if (!/timeout after \d+ms/.test(line)) return armFail("the line does not name the probe timeout", child)
    const mustStayOk = process.platform === "win32" ? ["node", "lsp"] : ["node", "ast-grep", "lsp", "comment-checker"]
    for (const id of mustStayOk) {
      if (!/\[(REQUIRED|OPTIONAL)\]: ok /.test(entryLine(child.stdout, id))) return armFail("the hung probe leaked into entry " + id, child)
    }
    return { ok: true, detail: "the fixture stub hung: MISSING-with-reason (timeout named, stub path named) and contained to its own entry, exit 2" }
  }],
  ["json-mode", (root) => {
    const fx = buildFixture(root, { name: "json-mode" })
    const child = runChild(["--bundle-root", fx.bundle, "--json"], fixtureEnv(fx))
    if (child.leak.length > 0) return armFail("hermeticity: the child names the real repo root " + child.leak.join(","), child)
    const want = process.platform === "win32" ? EXIT.optionalMissing : EXIT.ok
    if (child.code !== want) return armFail("exit=" + child.code + " (want " + want + ")", child)
    const line = child.stdout.split("\n").find((l) => l.startsWith(PREFIXED_JSON))
    if (line === undefined) return armFail("no `" + PREFIXED_JSON + "{...}` line on stdout", child)
    let parsed
    try { parsed = JSON.parse(line.slice(PREFIXED_JSON.length)) } catch (error) { return armFail("the json line does not parse: " + oneLine(error && error.message ? error.message : String(error)), child) }
    if (parsed.verdict?.code !== want || parsed.entries?.length !== ENTRY_SPECS.length) return armFail("the payload carries verdict.code=" + parsed.verdict?.code + " and " + parsed.entries?.length + " entries", child)
    if (!parsed.entries.every((entry) => typeof entry.id === "string" && typeof entry.degrade === "string" && typeof entry.resolution === "string" && entry.envKeys !== undefined)) return armFail("an entry record is missing id/degrade/resolution/envKeys", child)
    return { ok: true, detail: "one prefixed JSON line, " + parsed.entries.length + " entry records with degrade + resolution, exit 0" }
  }],
]

function runSelfTest() {
  const root = mkdtempSync(join(tmpdir(), "mpd-doctor-selftest-"))
  const results = []
  try {
    for (const [name, run] of ARMS) {
      let outcome
      try {
        outcome = run(root)
      } catch (error) {
        outcome = armFail("arm threw: " + oneLine(error && error.message ? error.message : String(error)), null)
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
  const passed = results.filter((result) => result.ok).length
  out("self-test census: arms=" + results.length + " passed=" + passed + " failed=" + (results.length - passed) + " fixture=" + root + " (mkdtemp; the real tree is never read)")
  if (passed !== results.length) {
    out("self-test FAIL: " + passed + "/" + results.length + " arms")
    return 1
  }
  out("self-test PASS: " + passed + "/" + results.length + " arms")
  return EXIT.ok
}

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
const report = doctor({ bundleRoot: args.bundleRoot, env: process.env, platform: process.platform })
emitReport(report, args)
process.exit(report.verdict.code)
