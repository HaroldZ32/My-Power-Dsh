#!/usr/bin/env node
// Offline build of ast-grep/git-bash MCP: copy source from the the upstream checkout (read-only) into a temp workspace,
// use bun cache for external dependencies, then after bun build copy dist artifacts into the mpd-dsh plugin package.
// The original repo stays untouched; artifacts go into the plugin package (plugin-form) with SHA256 recorded in BUILD.lock.
import { spawnSync } from "node:child_process"
import { createHash, randomUUID } from "node:crypto"
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, symlinkSync, mkdtempSync } from "node:fs"
import { tmpdir, homedir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
// Legacy layout assumed repoRoot = <the upstream checkout>/.mpd/port/mpd-dsh. Override with
// MPD_UPSTREAM_ROOT when the repo lives elsewhere (e.g. /home/haroldzhao/dshProj/the upstream project).
const mpdRoot = process.env.MPD_UPSTREAM_ROOT || join(repoRoot, "..", "..", "..")
const cacheRoot = join(homedir(), ".bun", "install", "cache")

const SERVERS = [
  { name: "ast-grep", src: "ast-grep-mcp", pkg: "mpd-mcp-astgrep", entry: "src/cli.ts", argv: [] },
  { name: "git-bash", src: "git-bash-mcp", pkg: "mpd-mcp-gitbash", entry: "src/cli.ts", argv: [] },
  { name: "lsp", src: "lsp-daemon", pkg: "mpd-mcp-lsp", entry: "src/cli.ts", argv: ["mcp"] }
]
// Hotfix (t3 Phase B, captain-approved): upstream checkout keeps the original
// package dir name omo-config-core (upstream is never renamed). The scrub
// renamed this reference to mpd-config-core but the dir does not exist there,
// which broke the offline build (ENOENT). Matches fix/repo-scan-20260830 F-16;
// remove this duplicate once that branch is merged into dev.
const CORE = ["mcp-stdio-core", "utils", "omo-config-core", "lsp-core"]
const EXTERNAL = { "js-yaml": "js-yaml@4.3.1", "jsonc-parser": "jsonc-parser@3.3.1", "zod": "zod@4.4.3" }

// --- RTL LSP overlay (t2 Option A): in-repo registration patches ---------------
// The overlay lives at packages/mpd-mcp-lsp/overlay/lsp/ and carries a
// drift-guard anchor marker. The anchor must exist in BOTH the overlay file
// and the overlay-applied source, otherwise the build FAILS loudly — this
// prevents silent divergence from the upstream lsp-core baseline (e.g. a stale
// overlay silently applied over a drifted upstream file). Overlay files are
// full patched copies of the upstream lsp-core files (owned by t3); the
// registry gains verible-verilog-ls (.v/.vh) and slang-server (.sv/.svh).
const LSP_OVERLAY_DIR = join(repoRoot, "packages", "mpd-mcp-lsp", "overlay", "lsp")
const BUILTIN_BUILD_ANCHOR = "mpd-rtl-overlay-v1"
const LSP_OVERLAY_FILES = [
  { name: "server-definitions.ts", rel: "src/lsp/server-definitions.ts", baselineExport: "BUILTIN_SERVERS" },
  { name: "language-mappings.ts", rel: "src/lsp/language-mappings.ts", baselineExport: "EXT_TO_LANG" },
]

// Apply the in-repo RTL LSP overlay over the freshly-copied upstream lsp-core
// source (inside the temp build workspace). Overlay missing/stale or upstream
// baseline drifted -> FAIL loudly instead of producing a silently wrong dist.
function applyLspOverlay(srcRoot) {
  for (const f of LSP_OVERLAY_FILES) {
    const overlayPath = join(LSP_OVERLAY_DIR, f.name)
    const sourcePath = join(srcRoot, "lsp-core", f.rel)
    if (!existsSync(overlayPath)) {
      console.error("[build-mcp] FAIL - RTL LSP overlay file missing: " + overlayPath)
      process.exit(1)
    }
    const overlayText = readFileSync(overlayPath, "utf8")
    if (!overlayText.includes(BUILTIN_BUILD_ANCHOR)) {
      console.error(`[build-mcp] FAIL - overlay ${f.name} lacks drift-guard anchor "${BUILTIN_BUILD_ANCHOR}" (stale/foreign overlay?)`)
      process.exit(1)
    }
    if (!existsSync(sourcePath)) {
      console.error("[build-mcp] FAIL - upstream lsp-core source missing: " + sourcePath)
      process.exit(1)
    }
    const sourceText = readFileSync(sourcePath, "utf8")
    if (!sourceText.includes(f.baselineExport)) {
      console.error(`[build-mcp] FAIL - upstream ${sourcePath} no longer exports ${f.baselineExport} (upstream baseline drifted?)`)
      process.exit(1)
    }
    cpSync(overlayPath, sourcePath)
    const appliedText = readFileSync(sourcePath, "utf8")
    if (!appliedText.includes(BUILTIN_BUILD_ANCHOR)) {
      console.error(`[build-mcp] FAIL - overlay ${f.name} did not apply (anchor missing after copy)`)
      process.exit(1)
    }
    console.log("[build-mcp] RTL LSP overlay applied: " + f.name + " -> " + sourcePath)
  }
}

// F6 fix: discover all cache entries by package-name prefix, prefer an exact match for the "expected version", otherwise take the highest version;
// write the actually resolved entries to BUILD.lock for reproducibility.
function findCache(entry) {
  const prefix = entry.split("@")[0]
  const matches = readdirSync(cacheRoot).filter((d) => d.startsWith(prefix + "@"))
  if (matches.length === 0) return null
  const want = entry.split("@")[1]
  const exact = matches.find((d) => d === entry)
  const chosen = exact ?? [...matches].sort((a, b) => {
    const va = a.slice(prefix.length + 1), vb = b.slice(prefix.length + 1)
    return vb.localeCompare(va, undefined, { numeric: true })
  })[0]
  return { path: join(cacheRoot, chosen), entry: chosen }
}

// --- MPD scrub (t3 Phase B, captain-approved): post-bundle OMO->MPD transform ---------
// The pristine upstream source still uses OMO_* identifiers; the committed dists were
// hand-scrubbed OMO->MPD by commit 7d8f910 (direct dist edits, no rebuild), and AGENTS.md
// pins the MPD_* contract (e.g. MPD_AST_GREP_SG_PATH). Apply the same key-level rename to
// the freshly built cli.js so future rebuilds reproduce the committed convention. This is
// a TARGETED key list, never a global sed over "omo" (that would corrupt unrelated words
// such as "from" or the OMO_CODEX_* codex contract kept literal in git-bash).
const MPD_SCRUB = {
  lsp: {
    replace: [
      ["OMO_DAEMON_PROTOCOL_VERSION", "MPD_DAEMON_PROTOCOL_VERSION"],
      ["OMO_LSP_DAEMON_CLI", "MPD_LSP_DAEMON_CLI"],
      ["OMO_LSP_DAEMON_DIR", "MPD_LSP_DAEMON_DIR"],
      ["OMO_LSP_DAEMON_VERSION", "MPD_LSP_DAEMON_VERSION"],
      [".omo", ".mpd"],
      ["omo-lsp-daemon", "mpd-lsp-daemon"],
      ["omo-lsp-", "mpd-lsp-"],
      ["omo/ping", "mpd/ping"],
    ],
    residual: ["OMO_", ".omo", "omo-lsp", "omo/ping"],
  },
  "ast-grep": {
    replace: [
      ["OMO_AST_GREP_BIN_DIR", "MPD_AST_GREP_BIN_DIR"],
      ["OMO_AST_GREP_SG_PATH", "MPD_AST_GREP_SG_PATH"],
      ["OMO_AST_GREP_PROJECT_CWD", "MPD_AST_GREP_PROJECT_CWD"],
      ["OMO_PROVISION_HINT", "MPD_PROVISION_HINT"],
      [".omo", ".mpd"],
      ["omoRuntimeCandidates", "mpdRuntimeCandidates"],
      ["omo-runtime", "mpd-runtime"],
      ["omo-ast-grep", "mpd-ast-grep"],
    ],
    residual: ["OMO_", ".omo", "omoRuntime", "omo-runtime", "omo-ast-grep"],
  },
  "git-bash": {
    // OMO_CODEX_* is the codex contract and stays literal; only the tmpdir prefix changes.
    replace: [["omo-git-bash-run-", "mpd-git-bash-run-"]],
    residual: ["omo-git-bash-run-"],
  },
}

// Apply the key-level OMO->MPD scrub to a built cli.js, then assert no residual remains
// (loud FAIL so a drifted upstream never silently ships an un-scrubbed dist).
function applyMpdScrub(serverName, text) {
  const cfg = MPD_SCRUB[serverName]
  if (!cfg) return text
  let out = text
  for (const [from, to] of cfg.replace) out = out.split(from).join(to)
  for (const residual of cfg.residual) {
    if (out.includes(residual)) {
      console.error(`[build-mcp] FAIL - ${serverName} dist still contains OMO residual "${residual}" after MPD scrub`)
      process.exit(1)
    }
  }
  return out
}


function sha(p) { return createHash("sha256").update(readFileSync(p)).digest("hex") }

const work = mkdtempSync(join(tmpdir(), "mpd-dsh-mcp-build-"))
try {
  const srcRoot = join(work, "src")
  mkdirSync(srcRoot, { recursive: true })
  for (const c of CORE) {
    cpSync(join(mpdRoot, "packages", c), join(srcRoot, c), { recursive: true, filter: (s) => !s.includes("node_modules") && !s.includes("dist") && !s.includes(".git") })
  }
  // RTL LSP overlay: apply in-repo registration patches over the copied
  // lsp-core source (drift-guarded). Must run after the lsp-core copy and
  // before any bun build so the registry bakes in verible/slang-server.
  applyLspOverlay(srcRoot)
  for (const s of SERVERS) {
    cpSync(join(mpdRoot, "packages", s.src), join(srcRoot, s.src), { recursive: true, filter: (p) => !p.includes("node_modules") && !p.includes("dist") && !p.includes(".git") })
  }
  // node_modules layout (mimic a bun workspace)
  const nm = join(work, "node_modules", "@oh-my-opencode")
  mkdirSync(nm, { recursive: true })
  for (const c of CORE) {
    symlinkSync(join(srcRoot, c), join(nm, c), "dir")
  }
  const extNm = join(work, "node_modules")
  const resolvedExternals = {}
  for (const [name, entry] of Object.entries(EXTERNAL)) {
    const from = findCache(entry)
    if (!from) { console.error("[build-mcp] bun cache missing external dependency: " + entry); process.exit(1) }
    symlinkSync(from.path, join(extNm, name), "dir")
    resolvedExternals[name] = from.entry
    console.log("[build-mcp] ext dep: " + name + " <- " + from.entry)
  }
  for (const s of SERVERS) {
    const dir = join(srcRoot, s.src)
    const r = spawnSync("bun", ["build", s.entry, "--outdir", "dist", "--target", "node", "--format", "esm"], { cwd: dir, encoding: "utf8", env: { ...process.env, NODE_PATH: join(work, "node_modules") } })
    if (r.status !== 0) { console.error("[build-mcp] build failed " + s.name + ":", r.stderr); process.exit(1) }
    const cli = join(dir, "dist", "cli.js")
    const out = join(repoRoot, "packages", s.pkg, "dist")
    mkdirSync(out, { recursive: true })
    // MPD scrub: apply the key-level OMO->MPD rename (if any) so the shipped dist
    // matches the committed convention (hand-scrubbed baseline, AGENTS.md contract).
    const builtText = applyMpdScrub(s.name, readFileSync(cli, "utf8"))
    writeFileSync(join(out, "cli.js"), builtText)
    writeFileSync(join(out, "BUILD.lock"), JSON.stringify({
      source: "the upstream project", sourceDir: "packages/" + s.src, builtAt: new Date().toISOString(),
      build: ["bun build " + s.entry + " --outdir dist --target node --format esm"],
      externalDeps: resolvedExternals,
      artifact: { file: "cli.js", sha256: sha(join(out, "cli.js")), bytes: builtText.length }
    }, null, 2) + "\n")
    console.log("[build-mcp] " + s.name + " -> " + join(out, "cli.js") + " (" + readFileSync(join(out, "cli.js")).length + " bytes)")
  }
} finally {
  rmSync(work, { recursive: true, force: true })
}
console.log("[build-mcp] PASS")
