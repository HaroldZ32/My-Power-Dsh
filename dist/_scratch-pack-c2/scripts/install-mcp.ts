#!/usr/bin/env node
// install-mcp: install AND activate every MCP the my-power-dsh bundle needs.
//
//   npm toolchain   @ast-grep/cli (sg) + @colbymchenry/codegraph  -> <toolchain>/node_modules/.bin
//   --with-wave     wave-mcp + traceweave-mcp via PIPX (each in its own isolated
//                   env; default bins ~/.local/bin; --wave-home overrides the
//                   pipx home + bin dir, UV_CACHE_DIR redirected beside it) — no
//                   hand-made venv (owner policy). Each env pins its own mcp SDK
//                   (wave-mcp needs mcp>=2 → mcp.server.mcpserver; TraceWeave
//                   pins mcp==1.27.0) so they can never clash at boot; install is
//                   verified by importing the required SDK module
//   activation      writes $HOME/.mpd/mcp.env (export lines; source it before dsh)
//   --activate-wave additionally writes $HOME/.mpd/mcp-wave.patch.yml (dsh --patch overlay)
//
// Usage: node scripts/install-mcp.ts [--toolchain <dir>] [--with-wave] [--env-out <file>]
//          [--activate-wave] [--dry-run] [--self-test]
// Never writes ~/.dsh. Never echoes credentials.
import { spawnSync } from "node:child_process"
import type { SpawnSyncReturns } from "node:child_process"
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { createWriteStream } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { delimiter, dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { repoRootFrom } from "./lib/repo.ts"

/** The repository root, derived from this script's own module URL. */
const repoRoot = repoRootFrom(import.meta.url)
/** The toolchain root that holds the npm-installed MCP binaries (`--toolchain` overrides it). */
const TOOLCHAIN = join(repoRoot, ".toolchain")
/** The default activation file, `$HOME/.mpd/mcp.env`, meant to be sourced before dsh. */
const ENV_OUT = join(homedir(), ".mpd", "mcp.env")
/** The default wave overlay patch, `$HOME/.mpd/mcp-wave.patch.yml`. */
const WAVE_PATCH = join(homedir(), ".mpd", "mcp-wave.patch.yml")
/** The npm packages providing the `sg` and `codegraph` console scripts; codegraph is version-pinned. */
const NPM_TOOLCHAIN = ["@ast-grep/cli", "@colbymchenry/codegraph@1.5.0"]
/** The two wave-MCP rows the `--activate-wave` overlay can add, with `!!js` runtime bin lookup. */
const WAVE_ROW = `- id: mcp-wave-mcp
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: wave_mcp
    transport: stdio
    command: !!js 'process.env.MPD_DSH_WAVE_MCP_BIN || "wave-mcp"'
    args:
      - "--session"
      - !!js 'process.env.MPD_DSH_WAVE_MCP_SESSION || (process.env.DSH_HOME ? process.env.DSH_HOME + "/wave-mcp" : ".wave-mcp")'
    toolCallTimeoutMs: 120000
- id: mcp-traceweave
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: traceweave
    transport: stdio
    command: !!js 'process.env.MPD_DSH_TRACEWEAVE_BIN || "traceweave-mcp"'
    toolCallTimeoutMs: 120000`

// --- platform name resolution ----------------------------------------------
// A bin NAME is not a path: win32 resolves it through %PATHEXT% (the toolchain tier holds
// `sg.cmd`/`sg.exe`, not `sg`), and the venv/pipx layouts differ too. Measured 2026-09-22:
// with the bare POSIX names this installer re-installed the toolchain on every run and then
// reported it missing, and its pipx probing (`sh -c command -v pipx`) answered nothing at all.
/** The filename suffixes a console script may carry here; win32 needs the full PATHEXT set. */
const BIN_SUFFIXES = process.platform === "win32" ? [".exe", ".cmd", ".bat", ".com", ""] : [""]

/** The on-disk name of an installed console script for this platform. */
function exeName(name: string): string { return process.platform === "win32" ? name + ".exe" : name }

/** The installed-script path for `name` inside `dir`, or null when no candidate exists.
 *  @param {string} dir @param {string} name @returns {string|null} */
function binIn(dir: string, name: string): string | null {
  for (const suffix of BIN_SUFFIXES) {
    /** The candidate filename for this platform suffix. */
    const candidate = join(dir, name + suffix)
    if (existsSync(candidate)) return candidate
  }
  return null
}

/** The first existing `name` on PATH, or null; empty PATH entries are skipped, not searched.
 *  @param {string} name @returns {string|null} */
function onPath(name: string): string | null {
  for (const dir of String(process.env.PATH ?? "").split(delimiter)) {
    if (dir.length === 0) continue
    /** The resolved candidate inside this PATH entry. */
    const found = binIn(dir, name)
    if (found !== null) return found
  }
  return null
}

/** The platform command interpreter, absolute: a bare `cmd.exe` is not on PATH in a minimal env. */
function commandInterpreter(): string | null {
  if (process.platform !== "win32") return null
  // `ComSpec` is the host's own answer when it is set; the narrowed local is what is returned.
  /** The host-declared interpreter path, when the environment carries one. */
  const comSpec = process.env.ComSpec
  if (comSpec) return comSpec
  /** The Windows root: `SystemRoot`, then the legacy `windir`, then the conventional path. */
  const root = process.env.SystemRoot ?? process.env.windir ?? "C:\\Windows"
  return join(root, "System32", "cmd.exe")
}

/** npm is a `.cmd` on win32: spawn it through the interpreter instead of a bare name. */
function runNpm(args: readonly string[]): SpawnSyncReturns<string | Buffer> {
  // `npm_execpath` identifies the npm that launched this script; held in a local so the spawn sees
  // exactly the string that was tested for presence.
  /** The npm entry point this process was launched by, when npm launched it. */
  const npmExecPath = process.env.npm_execpath
  if (npmExecPath) return sh(npmExecPath, args)
  /** The win32 command interpreter, or null on a platform that can spawn `npm` directly. */
  const interpreter = commandInterpreter()
  if (interpreter === null) return sh("npm", args)
  return sh(interpreter, ["/d", "/c", "npm", ...args])
}

/** The parsed invocation, shared by every mode below. */
const opts = parseArgs(process.argv.slice(2))

/** Parses argv into the run options; an unknown flag is a usage error and exits 2. */
function parseArgs(argv: string[]): Options {
  /** The defaults: the repo toolchain, `$HOME/.mpd/mcp.env`, and nothing installable selected. */
  const o: Options = { toolchain: TOOLCHAIN, envOut: ENV_OUT, withWave: false, activateWave: false, dryRun: false, selfTest: false, force: false }
  for (let i = 0; i < argv.length; i++) {
    /** The argument under inspection. */
    const a = argv[i]
    if (a === "--toolchain") o.toolchain = resolve(argv[++i])
    else if (a === "--env-out") o.envOut = resolve(argv[++i])
    else if (a === "--wave-home") o.waveHome = resolve(argv[++i])
    else if (a === "--with-wave") o.withWave = true
    else if (a === "--activate-wave") { o.withWave = true; o.activateWave = true }
    else if (a === "--check") o.check = true
    else if (a === "--dry-run") o.dryRun = true
    else if (a === "--self-test") o.selfTest = true
    else if (a === "--force") o.force = true
    else { console.error("[install-mcp] unknown arg: " + a); process.exit(2) }
  }
  if (o.selfTest) { selfTest(); process.exit(0) }
  return o
}

/** The run options: one per CLI flag, plus the two that are only set when their flag appears. */
interface Options {
  /** The toolchain root the npm tier installs into. */
  toolchain: string
  /** The file the activation export lines are written to. */
  envOut: string
  /** True when the two wave MCPs must also be installed (implied by `--activate-wave`). */
  withWave: boolean
  /** True when the wave overlay patch must also be written. */
  activateWave: boolean
  /** True when only the on-disk definitions are scanned for a stale `--session` row (`--check`). */
  check?: boolean
  /** True when nothing may be installed or written (`--dry-run`). */
  dryRun: boolean
  /** True when the built-in assertions run and the process exits 0 (`--self-test`). */
  selfTest: boolean
  /** True when an existing pipx install is reinstalled anyway (`--force`). */
  force: boolean
  /** The pipx home override; unset means pipx's own default under `$HOME` (`--wave-home`). */
  waveHome?: string
}

/** Prints the FAIL line and marks the process failed WITHOUT exiting, so later steps still run. */
function fail(msg: string): void { console.error("[install-mcp] FAIL: " + msg); process.exitCode = 1 }

/** The subset of `spawnSync` options this installer passes. */
interface RunOptions {
  /** True when the child's output is captured instead of inherited. */
  readonly silent?: boolean
  /** The hard kill deadline in milliseconds. */
  readonly timeout?: number
  /** The environment for the child; unset means this process's own environment. */
  readonly env?: NodeJS.ProcessEnv
}

/** Spawns a child to completion; `silent` captures its streams instead of inheriting them. */
function sh(cmd: string, args: readonly string[], opts: RunOptions = {}): SpawnSyncReturns<string | Buffer> {
  /** The stream encoding: text only when the streams are captured. */
  const encoding: BufferEncoding | undefined = opts.silent ? "utf8" : undefined
  /** The completed child run. */
  const r = spawnSync(cmd, args, { stdio: opts.silent ? "pipe" : "inherit", encoding, timeout: opts.timeout ?? 600000, env: opts.env ?? process.env })
  return r
}

/** True when a console script already exists at `binPath`. */
function installed(binPath: string): boolean { return existsSync(binPath) }

// --- 1) npm toolchain (sg + codegraph) -------------------------------------
/** Installs the npm tier when either console script is missing; true when both exist afterwards. */
function ensureNpmToolchain(): boolean {
  /** The toolchain's own bin directory, where `sg` and `codegraph` land. */
  const bin = join(opts.toolchain, "node_modules", ".bin")
  /** The two console scripts this tier must provide. */
  const need = ["sg", "codegraph"]
  /** The subset of `need` that is not on disk yet. */
  const missing = need.filter((name: string): boolean => binIn(bin, name) === null)
  if (missing.length === 0) { console.log("[install-mcp] npm toolchain up to date:", join(opts.toolchain, "node_modules/.bin")); return true }
  console.log("[install-mcp] installing npm toolchain:", NPM_TOOLCHAIN.join(" + "))
  /** The npm install run, with its cache kept inside the toolchain. */
  const r = runNpm(["install", "--prefix", opts.toolchain, "--no-save", "--no-audit", "--no-fund", "--cache", join(opts.toolchain, ".npm-cache"), ...NPM_TOOLCHAIN])
  if (r.status !== 0) { fail("npm toolchain install failed (network?): " + (r.stderr || "").slice(-300)); return false }
  return need.every((name: string): boolean => binIn(bin, name) !== null)
}

// --- 3) wave MCPs via PIPX (each app isolated; NO hand-made venv) ----------
// wave-mcp needs mcp>=2 (module mcp.server.mcpserver), TraceWeave pins
// mcp==1.27.0 — they MUST NOT share one python. pipx gives each app its own
// isolated environment with its own mcp SDK, and the console binaries land in
// the pipx bin dir (default ~/.local/bin; override with --wave-home → the bin
// dir becomes <wave-home>/bin, matching PIPX_HOME/PIPX_BIN_DIR).
/** The directory the wave console scripts are linked into: `<wave-home>/bin`, else `~/.local/bin`. */
function pipxBinDir(): string {
  return opts.waveHome ? join(opts.waveHome, "bin") : join(homedir(), ".local", "bin")
}
/** Installs/verifies both wave MCPs in their own pipx envs; false when pipx itself is missing. */
function ensureWave(): boolean {
  // No shell probe: `sh -c command -v pipx` is POSIX-only, and on win32 it needs a sh that a
  // stock host may not have at all. The PATH scan resolves pipx.cmd / pipx.exe too.
  /** The resolved pipx console script, or null when pipx is not installed. */
  const pipxCmd = onPath("pipx")
  if (pipxCmd === null) { fail("pipx not found; install it (python3 -m pip install --user pipx) then rerun --with-wave"); return false }
  /** The pipx home: `--wave-home`, else pipx's own default under `$HOME`. */
  const home = opts.waveHome || join(homedir(), ".local", "pipx")
  /** The directory the console scripts are linked into. */
  const binDir = pipxBinDir()
  // uv backend caches under ~/.cache/uv; redirect it next to the pipx home so
  // installs work even where the default cache dir is read-only (sandboxes).
  /** The uv cache directory, kept beside the pipx home so a read-only default cache cannot break it. */
  const uvCache = join(dirname(home), "uv-cache")
  /** The environment every pipx call runs with: isolated home and bin dir, redirected uv cache. */
  const pipxEnv: NodeJS.ProcessEnv = { ...process.env, PIPX_HOME: home, PIPX_BIN_DIR: binDir, UV_CACHE_DIR: uvCache }
  for (const w of WAVE_INSTALL) {
    /** The console script path this wave MCP should end up at. */
    const bin = binIn(binDir, w.cmd) ?? join(binDir, exeName(w.cmd))
    /** True when the install already exists and `--force` did not ask for a reinstall. */
    const usable = existsSync(bin) && !opts.force
    if (usable) { console.log("[install-mcp] " + w.cmd + " already installed (pipx):", bin); continue }
    console.log("[install-mcp] pipx install " + w.pkg + " (own mcp SDK, isolated env) ...")
    /** The pipx install run, capped at ten minutes and captured so its stderr can be trimmed. */
    const r = sh(pipxCmd, ["install", w.pkg], { timeout: 600000, silent: true, env: pipxEnv })
    if (r.status !== 0) { fail(w.pkg + " pipx install failed: " + (r.stderr || "").slice(-300) + "\ninstall manually: pipx install " + w.pkg); continue }
    // verify the mcp SDK module the dsh MCP client needs actually imports
    // venv layout: posix `<venv>/bin/python`, win32 `<venv>/Scripts/python.exe`.
    /** The interpreter of this package's own pipx venv, by platform layout. */
    const venvPy = process.platform === "win32" ? join(home, "venvs", w.cmd, "Scripts", "python.exe") : join(home, "venvs", w.cmd, "bin", "python")
    /** The SDK import check inside that venv; `print('verify OK')` makes success visible. */
    const v = sh(venvPy, ["-c", w.verify + "; print('verify OK')"], { silent: true })
    if (v.status !== 0) { fail(w.cmd + " verify failed: mcp SDK in its pipx env is missing/wrong (" + (v.stderr || "").slice(-200) + ")"); continue }
    console.log("[install-mcp] " + w.cmd + " verify OK (mcp SDK present in its pipx env) ->", bin)
  }
  return true
}

// --- 4) activation artifacts ----------------------------------------------
/** One wave MCP to install through pipx, with the env key and SDK check its env needs. */
interface WaveInstall {
  /** The pipx package name to install. */
  readonly pkg: string
  /** The console script the package installs (also its directory name under `<PIPX_HOME>/venvs`). */
  readonly cmd: string
  /** The environment key the generated activation file exports for this MCP's binary. */
  readonly envk: string
  /** The mcp SDK requirement pinned in this package's own isolated env (documentation value). */
  readonly mcpRe: string
  /** The python import that must succeed to prove the env carries a usable mcp SDK. */
  readonly verify: string
}
/** The wave MCPs, each installed in its OWN pipx environment so their SDK pins cannot clash. */
const WAVE_INSTALL: readonly WaveInstall[] = [
  { pkg: "wave-mcp", cmd: "wave-mcp", envk: "MPD_DSH_WAVE_MCP_BIN", mcpRe: "mcp>=2", verify: "import mcp.server.mcpserver" },
  { pkg: "traceweave-mcp", cmd: "traceweave-mcp", envk: "MPD_DSH_TRACEWEAVE_BIN", mcpRe: "mcp==1.27.0", verify: "import mcp" },
]

/** The `export` lines of the activation file; `withWave` adds one pin per wave MCP binary. */
function envLines(toolchain: string, withWave: boolean = false, pipxBin: string = join(homedir(), ".local", "bin")): string[] {
  // The pin must name the file that EXISTS on this platform (`.bin/sg.exe` here, not `.bin/sg`):
  // a wrong non-empty pin is worse than an unset one - it silently disables the MCP's own chain.
  /** The toolchain's bin directory, where the pinned binaries live. */
  const toolchainBin = join(toolchain, "node_modules", ".bin")
  /** The lines in order: the banner, the two absolute pins, then the optional PATH entry. */
  const l = [
    "# my-power-dsh MCP activation (generated by scripts/install-mcp.ts; source before dsh)",
    'export MPD_AST_GREP_SG_PATH="' + (binIn(toolchainBin, "sg") ?? join(toolchainBin, "sg")) + '"',
    'export MPD_CODEGRAPH_BIN="' + (binIn(toolchainBin, "codegraph") ?? join(toolchainBin, "codegraph")) + '"',
    'export PATH="' + join(toolchain, "bin") + ':$PATH"   # toolchain bin dir (optional user binaries)',
  ]
  if (!withWave) return l
  for (const w of WAVE_INSTALL) l.push('export ' + w.envk + '="' + join(pipxBin, exeName(w.cmd)) + '"')
  return l
}

/** The overlay patch text adding both wave-MCP rows, with ABSOLUTE pipx bin paths baked in. */
function waveRef(pipxBin: string = join(homedir(), ".local", "bin")): string {
  // Bake in ABSOLUTE pipx bin paths so the rows work even when the dsh
  // launching shell never sourced the env (web GUI / systemd services): the
  // command falls back from MPD_DSH_*_BIN to the pipx bin path directly.
  /** The absolute path of the wave-mcp console script this overlay pins. */
  const waveBin = join(pipxBin, exeName("wave-mcp"))
  /** The absolute path of the traceweave-mcp console script this overlay pins. */
  const traceBin = join(pipxBin, exeName("traceweave-mcp"))
  return [
    "# my-power-dsh wave-MCP activation (generated by scripts/install-mcp.ts --activate-wave).",
    "# Boot dsh with: dsh --profile web --patch " + WAVE_PATCH + "  (GUI: merge these rows into",
    "# your profile cordis.patch.yml, or add the file to the profile's --patch chain).",
    "# Commands carry ABSOLUTE paths to the isolated installs — no env sourcing needed.",
    "- insert:",
    "  - id: mcp-wave-mcp",
    "    name: '@deepseek-ai/dsh-mcp-client'",
    "    config:",
    "      serverName: wave_mcp",
    "      transport: stdio",
    "      command: !!js 'process.env.MPD_DSH_WAVE_MCP_BIN || \"" + waveBin + "\"'",
    "      # No --session at startup: wave-mcp 0.1.1 treats --session as an",
    "      # OPTIONAL auto-open, and a missing session.json makes it exit with",
    "      # FileNotFoundError (session manifest not found). The plugin creates",
    "      # the session later via mcp__wave_mcp__prepare_session after a sim run.",
    "      toolCallTimeoutMs: 120000",
    "  - id: mcp-traceweave",
    "    name: '@deepseek-ai/dsh-mcp-client'",
    "    config:",
    "      serverName: traceweave",
    "      transport: stdio",
    "      command: !!js 'process.env.MPD_DSH_TRACEWEAVE_BIN || \"" + traceBin + "\"'",
    "      toolCallTimeoutMs: 120000",
  ].join("\n") + "\n"
}


// --- diagnostic: scan every place a wave row could be loaded and report any
//     that still carry --session (the wave-mcp boot crash source) -------------
/** Scans the generated overlay, both bundle patches and every profile patch for a stale row. */
function check(): void {
  /** The on-disk definitions to scan, as (label, path) pairs in reporting order. */
  const targets: ReadonlyArray<readonly [string, string]> = [
    ["generated overlay", join(homedir(), ".mpd", "mcp-wave.patch.yml")],
    ["bundle patch (source)", join(repoRoot, "cordis.patch.yml")],
    ["bundle patch (dist)", join(repoRoot, "dist", "mpd-package", "cordis.patch.yml")],
  ]
  /** How many scanned definitions still carry the stale row; a non-zero count fails the run. */
  let bad = 0
  for (const [label, file] of targets) {
    /** The file's text, or empty when it does not exist (reported and skipped). */
    let txt = ""
    try { txt = readFileSync(file, "utf8") } catch { console.log("[install-mcp] " + label + ": missing (" + file + ")"); continue }
    // a real --session row is an uncommented "args:" under a wave row; comments
    // mentioning --session (docs) are fine.
    /** The file's lines, scanned for the wave rows. */
    const lines = txt.split("\n")
    /** True while the scan sits inside a wave row (cleared by a comment naming the next row id). */
    let inWave = false
    /** Legacy scan flag kept from the original body; it is not read by any branch below. */
    let hasArgs = false
    /** The offending lines of THIS file, empty when the file is clean. */
    const badLines: string[] = []
    for (const ln of lines) {
      /** The line without surrounding whitespace, which is what the markers are matched against. */
      const t = ln.trim()
      if (t.startsWith("- id: mcp-wave-mcp") || t.startsWith("- id: mcp-traceweave")) { inWave = true; continue }
      if (inWave && /^#/.test(t)) { if (t.includes("id: mcp-")) inWave = false; continue }
      if (inWave && t.includes("--session")) badLines.push(t)
    }
    if (badLines.length) { console.log("[install-mcp] " + label + ": *** STILL HAS --session ROW (" + file + "): " + badLines.join(" | ")); bad++ }
    else console.log("[install-mcp] " + label + ": OK (no uncommented --session)")
  }
  /** The profile patch directories under the real home that may still carry a wave row. */
  const patchDirs = ["web", "tui", "mpd", "mpd-headless"]
  for (const p of patchDirs) {
    /** The profile's own patch file. */
    const f = join(homedir(), ".dsh", "profiles", p, "cordis.patch.yml")
    if (!existsSync(f)) continue
    /** The profile patch's text, scanned for a `--session` wave row. */
    const txt = readFileSync(f, "utf8")
    if (txt.includes("--session") && (txt.includes("wave-mcp") || txt.includes("wave_mcp"))) {
      console.log("[install-mcp] profile " + p + " patch: *** STILL HAS --session wave row"); bad++
    } else console.log("[install-mcp] profile " + p + " patch: OK")
  }
  if (bad) { console.log("[install-mcp] check: FAIL — old --session wave config found; reinstall bundle + regenerate overlay + fully restart dsh"); process.exit(1) }
  console.log("[install-mcp] check: PASS — every wave definition is session-free")
}

/** Writes the activation artifacts and prints them, so a failed write is still usable by hand. */
function act(): void {
  /** The `export` lines destined for the env file. */
  const env = envLines(opts.toolchain, opts.withWave, pipxBinDir())
  for (const [file, content] of [[opts.envOut, env.join("\n") + "\n"], ...(opts.activateWave ? [[WAVE_PATCH, waveRef(pipxBinDir())]] : [])]) {
    try {
      writeFileSync(file, content)
      console.log("[install-mcp] written ->", file)
    } catch (e) {
      // `code` is Node's errno string (`EACCES`, `EROFS`, …); the shape cast is the throwable
      // boundary, and a throwable carrying no `code` prints `undefined` exactly as before.
      /** The fs errno this write failed with, when the throwable carries one. */
      const errno = (e as { readonly code?: string | number }).code
      console.log("[install-mcp] cannot write " + file + " (" + errno + "); content printed below — write it yourself or pass --env-out to a writable path")
    }
  }
  console.log("\n" + env.join("\n"))
  if (opts.activateWave) {
    console.log("\n" + waveRef(pipxBinDir()))
    console.log("  boot with:   dsh --profile web --patch " + WAVE_PATCH)
    console.log("  (web GUI: merge the two rows into your profile patch, or add this file to the patch chain)")
  }
  console.log("\n[install-mcp] next: source " + opts.envOut + " in the shell that launches dsh, then restart dsh.")
}

// --- self-test -------------------------------------------------------------
/** The built-in assertions: each generated artifact must carry its key content. */
function selfTest(): void {
  /** The failed assertions, named by their subject. */
  const errors: string[] = []
  if (!NPM_TOOLCHAIN.includes("@ast-grep/cli") || !NPM_TOOLCHAIN.some((p: string): boolean => p.includes("codegraph"))) errors.push("toolchain pkgs")
  if (!WAVE_ROW.includes("mcp-wave-mcp") || !WAVE_ROW.includes("mcp-traceweave") || !WAVE_ROW.includes("MPD_DSH_WAVE_MCP_BIN")) errors.push("wave rows")
  if (!envLines(TOOLCHAIN, false, join(homedir(), ".local", "bin")).some((s: string): boolean => s.includes("MPD_AST_GREP_SG_PATH"))) errors.push("env lines")
  /** The generated overlay text under test. */
  const ref = waveRef(join(homedir(), ".local", "bin"))
  if (!ref.includes("- id: mcp-wave-mcp") || !ref.includes("- id: mcp-traceweave") || !ref.includes("- insert:")) errors.push("overlay")
  if (errors.length) { console.error("[install-mcp self-test] FAIL: " + errors.join(", ")); process.exit(1) }
  console.log("[install-mcp self-test] ok: toolchain pkgs + wave rows + env lines + overlay verified")
}

// --- main ------------------------------------------------------------------
/** True when `p` is an existing directory; a missing path answers false instead of throwing. */
function isDir(p: string): boolean { try { return statSync(p).isDirectory() } catch { return false } }
/** The directory entries of `d`, or an empty list when it cannot be read. */
function readdirSafe(d: string): string[] { try { return readdirSync(d) } catch { return [] } }

/** The mode dispatcher: `--check`, `--dry-run`, or the real install path. */
async function main(): Promise<void> {
  if (opts.check) { check(); return }
  if (opts.dryRun) {
    console.log("[install-mcp] DRY-RUN — would:")
    console.log("  - npm toolchain:", NPM_TOOLCHAIN.join(" + "), "->", join(opts.toolchain, "node_modules/.bin"))
    if (opts.withWave) console.log("  - pipx install wave-mcp (mcp>=2) + traceweave-mcp (mcp==1.27.0); bins ->", pipxBinDir())
    console.log("  - env ->", opts.envOut)
    if (opts.activateWave) console.log("  - wave overlay ->", WAVE_PATCH)
    console.log("\n" + envLines(opts.toolchain, opts.withWave, pipxBinDir()).join("\n"))
    if (opts.activateWave) console.log("\n" + waveRef(pipxBinDir()))
    return
  }
  ensureNpmToolchain()
  if (opts.withWave) ensureWave()
  act()
}

void main()
