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
// Usage: node scripts/install-mcp.mjs [--toolchain <dir>] [--with-wave] [--env-out <file>]
//          [--activate-wave] [--dry-run] [--self-test]
// Never writes ~/.dsh. Never echoes credentials.
import { spawnSync } from "node:child_process"
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { createWriteStream } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { delimiter, dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const TOOLCHAIN = join(repoRoot, ".toolchain")
const ENV_OUT = join(homedir(), ".mpd", "mcp.env")
const WAVE_PATCH = join(homedir(), ".mpd", "mcp-wave.patch.yml")
const NPM_TOOLCHAIN = ["@ast-grep/cli", "@colbymchenry/codegraph@1.5.0"]
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
const BIN_SUFFIXES = process.platform === "win32" ? [".exe", ".cmd", ".bat", ".com", ""] : [""]

/** The on-disk name of an installed console script for this platform. */
function exeName(name) { return process.platform === "win32" ? name + ".exe" : name }

/** @param {string} dir @param {string} name @returns {string|null} */
function binIn(dir, name) {
  for (const suffix of BIN_SUFFIXES) {
    const candidate = join(dir, name + suffix)
    if (existsSync(candidate)) return candidate
  }
  return null
}

/** @param {string} name @returns {string|null} */
function onPath(name) {
  for (const dir of String(process.env.PATH ?? "").split(delimiter)) {
    if (dir.length === 0) continue
    const found = binIn(dir, name)
    if (found !== null) return found
  }
  return null
}

/** The platform command interpreter, absolute: a bare `cmd.exe` is not on PATH in a minimal env. */
function commandInterpreter() {
  if (process.platform !== "win32") return null
  if (process.env.ComSpec) return process.env.ComSpec
  const root = process.env.SystemRoot ?? process.env.windir ?? "C:\\Windows"
  return join(root, "System32", "cmd.exe")
}

/** npm is a `.cmd` on win32: spawn it through the interpreter instead of a bare name. */
function runNpm(args) {
  if (process.env.npm_execpath) return sh(process.env.npm_execpath, args)
  const interpreter = commandInterpreter()
  if (interpreter === null) return sh("npm", args)
  return sh(interpreter, ["/d", "/c", "npm", ...args])
}

const opts = parseArgs(process.argv.slice(2))

function parseArgs(argv) {
  const o = { toolchain: TOOLCHAIN, envOut: ENV_OUT, withWave: false, activateWave: false, dryRun: false, selfTest: false, force: false }
  for (let i = 0; i < argv.length; i++) {
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

function fail(msg) { console.error("[install-mcp] FAIL: " + msg); process.exitCode = 1 }

function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: opts.silent ? "pipe" : "inherit", encoding: opts.silent ? "utf8" : undefined, timeout: opts.timeout ?? 600000, env: opts.env ?? process.env })
  return r
}

function installed(binPath) { return existsSync(binPath) }

// --- 1) npm toolchain (sg + codegraph) -------------------------------------
function ensureNpmToolchain() {
  const bin = join(opts.toolchain, "node_modules", ".bin")
  const need = ["sg", "codegraph"]
  const missing = need.filter((name) => binIn(bin, name) === null)
  if (missing.length === 0) { console.log("[install-mcp] npm toolchain up to date:", join(opts.toolchain, "node_modules/.bin")); return true }
  console.log("[install-mcp] installing npm toolchain:", NPM_TOOLCHAIN.join(" + "))
  const r = runNpm(["install", "--prefix", opts.toolchain, "--no-save", "--no-audit", "--no-fund", "--cache", join(opts.toolchain, ".npm-cache"), ...NPM_TOOLCHAIN])
  if (r.status !== 0) { fail("npm toolchain install failed (network?): " + (r.stderr || "").slice(-300)); return false }
  return need.every((name) => binIn(bin, name) !== null)
}

// --- 3) wave MCPs via PIPX (each app isolated; NO hand-made venv) ----------
// wave-mcp needs mcp>=2 (module mcp.server.mcpserver), TraceWeave pins
// mcp==1.27.0 — they MUST NOT share one python. pipx gives each app its own
// isolated environment with its own mcp SDK, and the console binaries land in
// the pipx bin dir (default ~/.local/bin; override with --wave-home → the bin
// dir becomes <wave-home>/bin, matching PIPX_HOME/PIPX_BIN_DIR).
function pipxBinDir() {
  return opts.waveHome ? join(opts.waveHome, "bin") : join(homedir(), ".local", "bin")
}
function ensureWave() {
  // No shell probe: `sh -c command -v pipx` is POSIX-only, and on win32 it needs a sh that a
  // stock host may not have at all. The PATH scan resolves pipx.cmd / pipx.exe too.
  const pipxCmd = onPath("pipx")
  if (pipxCmd === null) { fail("pipx not found; install it (python3 -m pip install --user pipx) then rerun --with-wave"); return false }
  const home = opts.waveHome || join(homedir(), ".local", "pipx")
  const binDir = pipxBinDir()
  // uv backend caches under ~/.cache/uv; redirect it next to the pipx home so
  // installs work even where the default cache dir is read-only (sandboxes).
  const uvCache = join(dirname(home), "uv-cache")
  const pipxEnv = { ...process.env, PIPX_HOME: home, PIPX_BIN_DIR: binDir, UV_CACHE_DIR: uvCache }
  for (const w of WAVE_INSTALL) {
    const bin = binIn(binDir, w.cmd) ?? join(binDir, exeName(w.cmd))
    const usable = existsSync(bin) && !opts.force
    if (usable) { console.log("[install-mcp] " + w.cmd + " already installed (pipx):", bin); continue }
    console.log("[install-mcp] pipx install " + w.pkg + " (own mcp SDK, isolated env) ...")
    const r = sh(pipxCmd, ["install", w.pkg], { timeout: 600000, silent: true, env: pipxEnv })
    if (r.status !== 0) { fail(w.pkg + " pipx install failed: " + (r.stderr || "").slice(-300) + "\ninstall manually: pipx install " + w.pkg); continue }
    // verify the mcp SDK module the dsh MCP client needs actually imports
    // venv layout: posix `<venv>/bin/python`, win32 `<venv>/Scripts/python.exe`.
    const venvPy = process.platform === "win32" ? join(home, "venvs", w.cmd, "Scripts", "python.exe") : join(home, "venvs", w.cmd, "bin", "python")
    const v = sh(venvPy, ["-c", w.verify + "; print('verify OK')"], { silent: true })
    if (v.status !== 0) { fail(w.cmd + " verify failed: mcp SDK in its pipx env is missing/wrong (" + (v.stderr || "").slice(-200) + ")"); continue }
    console.log("[install-mcp] " + w.cmd + " verify OK (mcp SDK present in its pipx env) ->", bin)
  }
  return true
}

// --- 4) activation artifacts ----------------------------------------------
const WAVE_INSTALL = [
  { pkg: "wave-mcp", cmd: "wave-mcp", envk: "MPD_DSH_WAVE_MCP_BIN", mcpRe: "mcp>=2", verify: "import mcp.server.mcpserver" },
  { pkg: "traceweave-mcp", cmd: "traceweave-mcp", envk: "MPD_DSH_TRACEWEAVE_BIN", mcpRe: "mcp==1.27.0", verify: "import mcp" },
]

function envLines(toolchain, withWave = false, pipxBin = join(homedir(), ".local", "bin")) {
  // The pin must name the file that EXISTS on this platform (`.bin/sg.exe` here, not `.bin/sg`):
  // a wrong non-empty pin is worse than an unset one - it silently disables the MCP's own chain.
  const toolchainBin = join(toolchain, "node_modules", ".bin")
  const l = [
    "# my-power-dsh MCP activation (generated by scripts/install-mcp.mjs; source before dsh)",
    'export MPD_AST_GREP_SG_PATH="' + (binIn(toolchainBin, "sg") ?? join(toolchainBin, "sg")) + '"',
    'export MPD_CODEGRAPH_BIN="' + (binIn(toolchainBin, "codegraph") ?? join(toolchainBin, "codegraph")) + '"',
    'export PATH="' + join(toolchain, "bin") + ':$PATH"   # toolchain bin dir (optional user binaries)',
  ]
  if (!withWave) return l
  for (const w of WAVE_INSTALL) l.push('export ' + w.envk + '="' + join(pipxBin, exeName(w.cmd)) + '"')
  return l
}

function waveRef(pipxBin = join(homedir(), ".local", "bin")) {
  // Bake in ABSOLUTE pipx bin paths so the rows work even when the dsh
  // launching shell never sourced the env (web GUI / systemd services): the
  // command falls back from MPD_DSH_*_BIN to the pipx bin path directly.
  const waveBin = join(pipxBin, exeName("wave-mcp"))
  const traceBin = join(pipxBin, exeName("traceweave-mcp"))
  return [
    "# my-power-dsh wave-MCP activation (generated by scripts/install-mcp.mjs --activate-wave).",
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
function check() {
  const targets = [
    ["generated overlay", join(homedir(), ".mpd", "mcp-wave.patch.yml")],
    ["bundle patch (source)", join(repoRoot, "packages", "mpd-bundle", "cordis.patch.yml")],
    ["bundle patch (dist)", join(repoRoot, "dist", "mpd-package", "cordis.patch.yml")],
  ]
  let bad = 0
  for (const [label, file] of targets) {
    let txt = ""
    try { txt = readFileSync(file, "utf8") } catch { console.log("[install-mcp] " + label + ": missing (" + file + ")"); continue }
    // a real --session row is an uncommented "args:" under a wave row; comments
    // mentioning --session (docs) are fine.
    const lines = txt.split("\n")
    let inWave = false, hasArgs = false, badLines = []
    for (const ln of lines) {
      const t = ln.trim()
      if (t.startsWith("- id: mcp-wave-mcp") || t.startsWith("- id: mcp-traceweave")) { inWave = true; continue }
      if (inWave && /^#/.test(t)) { if (t.includes("id: mcp-")) inWave = false; continue }
      if (inWave && t.includes("--session")) badLines.push(t)
    }
    if (badLines.length) { console.log("[install-mcp] " + label + ": *** STILL HAS --session ROW (" + file + "): " + badLines.join(" | ")); bad++ }
    else console.log("[install-mcp] " + label + ": OK (no uncommented --session)")
  }
  const patchDirs = ["web", "tui", "mpd", "mpd-headless"]
  for (const p of patchDirs) {
    const f = join(homedir(), ".dsh", "profiles", p, "cordis.patch.yml")
    if (!existsSync(f)) continue
    const txt = readFileSync(f, "utf8")
    if (txt.includes("--session") && (txt.includes("wave-mcp") || txt.includes("wave_mcp"))) {
      console.log("[install-mcp] profile " + p + " patch: *** STILL HAS --session wave row"); bad++
    } else console.log("[install-mcp] profile " + p + " patch: OK")
  }
  if (bad) { console.log("[install-mcp] check: FAIL — old --session wave config found; reinstall bundle + regenerate overlay + fully restart dsh"); process.exit(1) }
  console.log("[install-mcp] check: PASS — every wave definition is session-free")
}

function act() {
  const env = envLines(opts.toolchain, opts.withWave, pipxBinDir())
  for (const [file, content] of [[opts.envOut, env.join("\n") + "\n"], ...(opts.activateWave ? [[WAVE_PATCH, waveRef(pipxBinDir())]] : [])]) {
    try {
      writeFileSync(file, content)
      console.log("[install-mcp] written ->", file)
    } catch (e) {
      console.log("[install-mcp] cannot write " + file + " (" + e.code + "); content printed below — write it yourself or pass --env-out to a writable path")
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
function selfTest() {
  const errors = []
  if (!NPM_TOOLCHAIN.includes("@ast-grep/cli") || !NPM_TOOLCHAIN.some((p) => p.includes("codegraph"))) errors.push("toolchain pkgs")
  if (!WAVE_ROW.includes("mcp-wave-mcp") || !WAVE_ROW.includes("mcp-traceweave") || !WAVE_ROW.includes("MPD_DSH_WAVE_MCP_BIN")) errors.push("wave rows")
  if (!envLines(TOOLCHAIN, false, join(homedir(), ".local", "bin")).some((s) => s.includes("MPD_AST_GREP_SG_PATH"))) errors.push("env lines")
  const ref = waveRef(join(homedir(), ".local", "bin"))
  if (!ref.includes("- id: mcp-wave-mcp") || !ref.includes("- id: mcp-traceweave") || !ref.includes("- insert:")) errors.push("overlay")
  if (errors.length) { console.error("[install-mcp self-test] FAIL: " + errors.join(", ")); process.exit(1) }
  console.log("[install-mcp self-test] ok: toolchain pkgs + wave rows + env lines + overlay verified")
}

// --- main ------------------------------------------------------------------
function isDir(p) { try { return statSync(p).isDirectory() } catch { return false } }
function readdirSafe(d) { try { return readdirSync(d) } catch { return [] } }

async function main() {
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
