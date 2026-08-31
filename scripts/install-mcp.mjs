#!/usr/bin/env node
// install-mcp: install AND activate every MCP the my-power-dsh bundle needs.
//
//   npm toolchain   @ast-grep/cli (sg) + @colbymchenry/codegraph  -> <toolchain>/node_modules/.bin
//   LSP binaries    verible-verilog-ls (chipsalliance/verible) + slang-server
//                   (hudson-trading/slang-server) latest GitHub releases -> <toolchain>/bin
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
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const TOOLCHAIN = join(repoRoot, ".toolchain")
const ENV_OUT = join(homedir(), ".mpd", "mcp.env")
const WAVE_PATCH = join(homedir(), ".mpd", "mcp-wave.patch.yml")
const NPM_TOOLCHAIN = ["@ast-grep/cli", "@colbymchenry/codegraph@1.5.0"]
const LSP_TARGETS = [
  { bin: "verible-verilog-ls", repo: "chipsalliance/verible", assetRe: /linux-static-x86_64\.tar\.gz$/ },
  { bin: "slang-server", repo: "hudson-trading/slang-server", assetRe: /linux[^.]*x(?:86_)?64/ },
]
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
  const need = NPM_TOOLCHAIN.map((p) => join(bin, p.startsWith("@colbymchenry") ? "codegraph" : "sg"))
  const missing = need.filter((p) => !installed(p))
  if (missing.length === 0) { console.log("[install-mcp] npm toolchain up to date:", join(opts.toolchain, "node_modules/.bin")); return true }
  console.log("[install-mcp] installing npm toolchain:", NPM_TOOLCHAIN.join(" + "))
  const r = sh(process.env.npm_execpath || "npm", ["install", "--prefix", opts.toolchain, "--no-save", "--no-audit", "--no-fund", "--cache", join(opts.toolchain, ".npm-cache"), ...NPM_TOOLCHAIN])
  if (r.status !== 0) { fail("npm toolchain install failed (network?): " + (r.stderr || "").slice(-300)); return false }
  return need.every((p) => installed(p))
}

// --- 2) LSP binaries (verible / slang) -------------------------------------
async function fetchLatestAsset(repo, assetRe) {
  const res = await fetch("https://api.github.com/repos/" + repo + "/releases/latest", { headers: { "user-agent": "my-power-dsh-install-mcp" } })
  if (!res.ok) throw new Error("GitHub API " + repo + " -> HTTP " + res.status)
  const rel = await res.json()
  const asset = (rel.assets || []).find((a) => assetRe.test(a.name))
  if (!asset) throw new Error("no matching asset for " + repo + " in release " + rel.tag_name)
  return { tag: rel.tag_name, name: asset.name, url: asset.browser_download_url }
}

async function download(url, dest) {
  const res = await fetch(url, { headers: { "user-agent": "my-power-dsh-install-mcp" } })
  if (!res.ok) throw new Error("download " + url.split("/").pop() + " -> HTTP " + res.status)
  mkdirSync(dirname(dest), { recursive: true })
  writeFileSync(dest, Buffer.from(await res.arrayBuffer()))
}

function findExecutable(dir, name) {
  const stack = [dir]
  while (stack.length) {
    const d = stack.pop()
    for (const e of readdirSafe(d)) {
      const p = join(d, e)
      if (e === name) return p
      if (isDir(p)) stack.push(p)
    }
  }
  return null
}

async function ensureLsp(target) {
  const destBin = join(opts.toolchain, "bin", target.bin)
  if (installed(destBin) && !opts.force) { console.log("[install-mcp] " + target.bin + " already installed:", destBin); return true }
  const tmp = mkdtempSync(join(tmpdir(), "mpd-lsp-"))
  try {
    console.log("[install-mcp] fetching " + target.bin + " (" + target.repo + " latest)...")
    const asset = await fetchLatestAsset(target.repo, target.assetRe)
    console.log("[install-mcp]   asset:", asset.name)
    const archive = join(tmp, asset.name)
    await download(asset.url, archive)
    if (asset.name.endsWith(".tar.gz")) {
      const r = sh("tar", ["-xzf", archive, "-C", tmp])
      if (r.status !== 0) throw new Error("tar extract failed")
    } else if (asset.name.endsWith(".zip")) {
      const r = sh("unzip", ["-o", "-q", archive, "-d", tmp])
      if (r.status !== 0) throw new Error("unzip extract failed")
    } else throw new Error("unsupported archive type: " + asset.name)
    const found = findExecutable(tmp, target.bin) || findExecutable(tmp, target.bin + (target.bin === "slang-server" ? "" : ""))
    if (!found) throw new Error("binary not found after extract: " + target.bin)
    mkdirSync(dirname(destBin), { recursive: true })
    copyFileSync(found, destBin)
    chmodSync(destBin, 0o755)
    console.log("[install-mcp] " + target.bin + " ->", destBin)
    return true
  } catch (e) {
    fail(target.bin + " install failed: " + e.message + " (network / GitHub access?)")
    return false
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
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
  const pipx = sh("sh", ["-c", "command -v pipx"], { silent: true })
  if (pipx.status !== 0 || !pipx.stdout.trim()) { fail("pipx not found; install it (python3 -m pip install --user pipx) then rerun --with-wave"); return false }
  const pipxCmd = pipx.stdout.trim()
  const home = opts.waveHome || join(homedir(), ".local", "pipx")
  const binDir = pipxBinDir()
  // uv backend caches under ~/.cache/uv; redirect it next to the pipx home so
  // installs work even where the default cache dir is read-only (sandboxes).
  const uvCache = join(dirname(home), "uv-cache")
  const pipxEnv = { ...process.env, PIPX_HOME: home, PIPX_BIN_DIR: binDir, UV_CACHE_DIR: uvCache }
  for (const w of WAVE_INSTALL) {
    const bin = join(binDir, w.cmd)
    const usable = existsSync(bin) && !opts.force
    if (usable) { console.log("[install-mcp] " + w.cmd + " already installed (pipx):", bin); continue }
    console.log("[install-mcp] pipx install " + w.pkg + " (own mcp SDK, isolated env) ...")
    const r = sh(pipxCmd, ["install", w.pkg], { timeout: 600000, silent: true, env: pipxEnv })
    if (r.status !== 0) { fail(w.pkg + " pipx install failed: " + (r.stderr || "").slice(-300) + "\ninstall manually: pipx install " + w.pkg); continue }
    // verify the mcp SDK module the dsh MCP client needs actually imports
    const venvPy = join(home, "venvs", w.cmd, "bin", "python")
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
  const l = [
    "# my-power-dsh MCP activation (generated by scripts/install-mcp.mjs; source before dsh)",
    'export MPD_AST_GREP_SG_PATH="' + join(toolchain, "node_modules/.bin/sg") + '"',
    'export MPD_CODEGRAPH_BIN="' + join(toolchain, "node_modules/.bin/codegraph") + '"',
    'export PATH="' + join(toolchain, "bin") + ':$PATH"   # verible-verilog-ls / slang-server',
  ]
  if (!withWave) return l
  for (const w of WAVE_INSTALL) l.push('export ' + w.envk + '="' + join(pipxBin, w.cmd) + '"')
  return l
}

function waveRef(pipxBin = join(homedir(), ".local", "bin")) {
  // Bake in ABSOLUTE pipx bin paths so the rows work even when the dsh
  // launching shell never sourced the env (web GUI / systemd services): the
  // command falls back from MPD_DSH_*_BIN to the pipx bin path directly.
  const waveBin = join(pipxBin, "wave-mcp")
  const traceBin = join(pipxBin, "traceweave-mcp")
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
    "      args:",
    "        - \"--session\"",
    "        - !!js 'process.env.MPD_DSH_WAVE_MCP_SESSION || (process.env.DSH_HOME ? process.env.DSH_HOME + \"/wave-mcp\" : \".wave-mcp\")'",
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
  if (!LSP_TARGETS.some((t) => t.bin === "verible-verilog-ls") || !LSP_TARGETS.some((t) => t.bin === "slang-server")) errors.push("lsp targets")
  if (!WAVE_ROW.includes("mcp-wave-mcp") || !WAVE_ROW.includes("mcp-traceweave") || !WAVE_ROW.includes("MPD_DSH_WAVE_MCP_BIN")) errors.push("wave rows")
  if (!envLines(TOOLCHAIN, false, join(homedir(), ".local", "bin")).some((s) => s.includes("MPD_AST_GREP_SG_PATH"))) errors.push("env lines")
  const ref = waveRef(join(homedir(), ".local", "bin"))
  if (!ref.includes("- id: mcp-wave-mcp") || !ref.includes("- id: mcp-traceweave") || !ref.includes("- insert:")) errors.push("overlay")
  if (errors.length) { console.error("[install-mcp self-test] FAIL: " + errors.join(", ")); process.exit(1) }
  console.log("[install-mcp self-test] ok: toolchain pkgs + LSP targets + wave rows + env lines + overlay verified")
}

// --- main ------------------------------------------------------------------
function isDir(p) { try { return statSync(p).isDirectory() } catch { return false } }
function readdirSafe(d) { try { return readdirSync(d) } catch { return [] } }

async function main() {
  if (opts.dryRun) {
    console.log("[install-mcp] DRY-RUN — would:")
    console.log("  - npm toolchain:", NPM_TOOLCHAIN.join(" + "), "->", join(opts.toolchain, "node_modules/.bin"))
    for (const t of LSP_TARGETS) console.log("  - " + t.bin, "->", join(opts.toolchain, "bin"), "(" + t.repo + " latest)")
    if (opts.withWave) console.log("  - isolated pip targets: wave-mcp (mcp>=2) + traceweave-mcp (mcp==1.27.0) ->", waveHome())
    console.log("  - env ->", opts.envOut)
    if (opts.activateWave) console.log("  - wave overlay ->", WAVE_PATCH)
    console.log("\n" + envLines(opts.toolchain, opts.withWave, pipxBinDir()).join("\n"))
    if (opts.activateWave) console.log("\n" + waveRef(pipxBinDir()))
    return
  }
  ensureNpmToolchain()
  for (const t of LSP_TARGETS) await ensureLsp(t)
  if (opts.withWave) ensureWave()
  act()
}

void main()
