#!/usr/bin/env node
// Offline build of ast-grep/git-bash MCP: copy source from the OMO upstream checkout (read-only) into a temp workspace,
// use bun cache for external dependencies, then after bun build copy dist artifacts into the mpd-dsh plugin package.
// The original repo stays untouched; artifacts go into the plugin package (plugin-form) with SHA256 recorded in BUILD.lock.
import { spawnSync } from "node:child_process"
import { createHash, randomUUID } from "node:crypto"
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, symlinkSync, mkdtempSync } from "node:fs"
import { tmpdir, homedir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
// The default is the legacy layout repoRoot = <upstream checkout>/.mpd/port/mpd-dsh. Override with
// MPD_UPSTREAM_ROOT when the checkout lives elsewhere; the actual OMO checkout layout used here is
// <repo>/.mpd-dsh/upstream (gitignored), whose packages/ hold ast-grep-mcp / git-bash-mcp /
// lsp-daemon / lsp-core / mcp-stdio-core / utils / omo-config-core.
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

// --- mpd LSP overlay: in-repo patched copies of the upstream lsp-core files ---
// The overlay lives at packages/mpd-mcp-lsp/overlay/lsp/ and carries a
// drift-guard anchor marker. The anchor must exist in BOTH the overlay file
// and the overlay-applied source, otherwise the build FAILS loudly — this
// prevents silent divergence from the upstream lsp-core baseline (e.g. a stale
// overlay silently applied over a drifted upstream file). Overlay files are
// full patched copies of the upstream lsp-core files; the anchor was renamed to
// mpd-lsp-overlay-v1 (t8) when the retired HDL registrations left the overlay,
// so both sides are checked for the SAME current marker.
const LSP_OVERLAY_DIR = join(repoRoot, "packages", "mpd-mcp-lsp", "overlay", "lsp")
const BUILTIN_BUILD_ANCHOR = "mpd-lsp-overlay-v1"
const LSP_OVERLAY_FILES = [
  { name: "server-definitions.ts", rel: "src/lsp/server-definitions.ts", baselineExport: "BUILTIN_SERVERS" },
  { name: "language-mappings.ts", rel: "src/lsp/language-mappings.ts", baselineExport: "EXT_TO_LANG" },
]

// Apply the in-repo LSP overlay over the freshly-copied upstream lsp-core
// source (inside the temp build workspace). Overlay missing/stale or upstream
// baseline drifted -> FAIL loudly instead of producing a silently wrong dist.
function applyLspOverlay(srcRoot) {
  for (const f of LSP_OVERLAY_FILES) {
    const overlayPath = join(LSP_OVERLAY_DIR, f.name)
    const sourcePath = join(srcRoot, "lsp-core", f.rel)
    if (!existsSync(overlayPath)) {
      console.error("[build-mcp] FAIL - mpd LSP overlay file missing: " + overlayPath)
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
    console.log("[build-mcp] mpd LSP overlay applied: " + f.name + " -> " + sourcePath)
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
export function applyMpdScrub(serverName, text) {
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

// --- mpd brand guard (t20 / X1) -------------------------------------------------------
// applyMpdScrub above is a TARGETED key list and asserts only the residuals it already
// knows, so a rebuild could still silently ship an upstream OMO token the list has never
// seen — measured 2026-09-13: OMO_PROVISION_HINT / omo-git-bash-run- / platformFromOptions
// shaped drift reappeared from pre-rebrand upstream source and only a manual
// `git checkout HEAD -- <dist>` restored the committed bytes. This guard is the mechanical
// complement: SCAN every built artifact and FAIL LOUDLY (non-zero, naming token + artifact)
// on any brand-shaped token that is not deliberately allowlisted below. It never rewrites
// anything: widening the transform into a global "omo" replace would corrupt unrelated
// identifiers — the measured false-positive class is `platformFromOpenCodeConfigPath`
// ("romO" across a morpheme boundary) and `platformFromOptions`.
//
// PRIMARY SUBJECT (captain correction, measured): the git-bash scrub's replace list holds only
// `omo-git-bash-run-`, so a bare `omo-git-bash` used in usage/help/error text passes through
// untouched and the loud residual check reports nothing. A bare `omo-git-bash` (any suffix, any
// embedding) is therefore exactly what this guard must fail on.
// DELIBERATELY OUT OF SCOPE: `platformFrmpdOptions`. Our older global omo->mpd rewrite corrupted
// upstream's English identifier `platformFromOptions`; a rebuild from upstream source produces the
// CORRECT spelling, so asserting on the corrupted one would freeze it. It contains no `omo` trigram
// and the guard neither flags nor blesses it.
//
// The allowlist is DATA (one entry per deliberately-kept foreign token) and follows
// classification (b) of the brand-contract review recorded in the reasons below.
export const BRAND_ALLOWLIST = [
  { token: "OMO_CODEX_GIT_BASH_PATH", artifact: "git-bash", reason: "X1 #1 (b): codex's env key (GIT_BASH_ENV_KEY); renaming it breaks the codex side's env reads" },
  { token: "OMO_CODEX_GIT_BASH_TIMEOUT_MS", artifact: "git-bash", reason: "X1 #2 (b): same codex env contract, timeout key" },
  { token: "OMO_CODEX_EXEC_COMMAND_TIMEOUT_MS", artifact: "git-bash", reason: "X1 #3 (b): same codex env contract, exec-timeout key" },
  { token: "_omo", artifact: "lsp", reason: "X1 #4 (b): the LSP daemon's auth-envelope wire key (params._omo, stripped before dispatch); renaming one side only breaks auth" },
]

// A brand-shaped token starts at a non-identifier boundary and is `omo` (optionally
// underscore-prefixed / suffixed). `platformFromOpenCodeConfigPath` cannot match: its
// "romO" is preceded by an alphanumeric. Case-insensitive so `_omo` and `OMO_*` both hit.
const BRAND_TOKEN_RE = /(?<![A-Za-z0-9])(_{0,2}omo(?:[A-Z][A-Za-z0-9]*|[-_][A-Za-z0-9]*|\/[A-Za-z0-9._-]*)*[-_\/]?)/gi

/** Every brand-shaped occurrence in one artifact text (deduped, in order of appearance). */
export function brandTokens(text) {
  return [...new Set([...text.matchAll(BRAND_TOKEN_RE)].map((match) => match[1]))]
}

/** Subject counts for one artifact: how many identifiers were inspected, how many brand hits. */
export function scanBrandTokens(text) {
  return { identifiers: (text.match(/[A-Za-z_$][A-Za-z0-9_$]*/g) ?? []).length, brand: brandTokens(text) }
}

/**
 * Fail loudly when a built artifact carries a brand token that is not allowlisted.
 * Exported so the negative control can drive it without rebuilding anything.
 */
export function assertBrandClean(artifact, text, allowlist = BRAND_ALLOWLIST) {
  const { identifiers, brand } = scanBrandTokens(text)
  if (identifiers === 0) {
    console.error(`[build-mcp] FAIL - brand guard: 0 identifiers inspected in ${artifact} (an empty scan is not a pass)`)
    process.exit(1)
  }
  const allowed = new Set(allowlist.filter((entry) => entry.artifact === artifact).map((entry) => entry.token.toLowerCase()))
  const violations = brand.filter((token) => !allowed.has(token.toLowerCase()))
  if (violations.length > 0) {
    for (const token of violations) {
      console.error(`[build-mcp] FAIL - foreign brand token "${token}" in ${artifact} (not on the X1 allowlist declared in this file)`)
    }
    process.exit(1)
  }
  return { identifiers, brand: brand.length, allowlisted: brand.length }
}

// --- PRIMARY GUARD: byte equality against the committed dist (t20 amendment) ----------
// The committed dists are the ground truth of the brand convention, so the primary check is a
// BYTE COMPARISON of the scrubbed artifact against the committed file: it catches an un-scrubbed
// spelling, a reverted key and any future drift nobody enumerated, without maintaining a list of
// spellings. The token allowlist above stays as a LAYERED check (a bare `[Oo][Mm][Oo]` shape scan
// would reject the legitimate committed bytes: lsp carries 5 x `_omo` + 2 x the upstream OpenCode
// identifier, git-bash 3 x OMO_CODEX_*).
// Practical limit, stated rather than hidden: a full rebuild needs the upstream checkout at
// MPD_UPSTREAM_ROOT plus bun, so this function is exported and is exercisable as a pure function
// over artifact bytes (committed files + seeded mutants) when a rebuild must not run.
function firstDifference(a, b) {
  const max = Math.min(a.length, b.length)
  for (let i = 0; i < max; i += 1) if (a[i] !== b[i]) return i
  return max
}
function lineAt(text, index) {
  return (text.slice(0, index).split("\n").pop() ?? "").trim().slice(0, 160)
}

/** Compare a scrubbed artifact against its committed dist. Exported for the negative control. */
export function assertRebuildMatchesCommitted(artifact, builtText, committedPath) {
  if (!existsSync(committedPath)) {
    console.warn(`[build-mcp] brand guard: no committed baseline for ${artifact} (${committedPath}); byte comparison skipped for this artifact`)
    return { compared: 0, bytes: 0 }
  }
  const committed = readFileSync(committedPath, "utf8")
  if (builtText === committed) return { compared: 1, bytes: Buffer.byteLength(builtText) }
  const at = firstDifference(builtText, committed)
  console.error(`[build-mcp] FAIL - ${artifact} rebuild differs from the committed dist at char ${at} (rebuilt ${Buffer.byteLength(builtText)} B vs committed ${Buffer.byteLength(committed)} B); the committed dists are the brand ground truth and a rebuild must reproduce them`)
  console.error(`[build-mcp] FAIL - rebuilt line: ${JSON.stringify(lineAt(builtText, at))} | committed line: ${JSON.stringify(lineAt(committed, at))}`)
  process.exit(1)
}

function main() {
const brandTotals = { artifacts: 0, identifiers: 0, brand: 0 }
const byteTotals = { compared: 0, bytes: 0 }
const work = mkdtempSync(join(tmpdir(), "mpd-dsh-mcp-build-"))
try {
  const srcRoot = join(work, "src")
  mkdirSync(srcRoot, { recursive: true })
  for (const c of CORE) {
    cpSync(join(mpdRoot, "packages", c), join(srcRoot, c), { recursive: true, filter: (s) => !s.includes("node_modules") && !s.includes("dist") && !s.includes(".git") })
  }
  // mpd LSP overlay: apply the in-repo patched copies over the copied
  // lsp-core source (drift-guarded). Must run after the lsp-core copy and
  // before any bun build so the patched registry is what gets baked in.
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
    const brandScan = assertBrandClean(s.name, builtText)
    brandTotals.artifacts += 1
    brandTotals.identifiers += brandScan.identifiers
    brandTotals.brand += brandScan.brand
    const byteScan = assertRebuildMatchesCommitted(s.name, builtText, join(out, "cli.js"))
    byteTotals.compared += byteScan.compared
    byteTotals.bytes += byteScan.bytes
    writeFileSync(join(out, "cli.js"), builtText)
    writeFileSync(join(out, "BUILD.lock"), JSON.stringify({
      // Provenance, not prose: the upstream OMO commit this dist was built from (VENDOR_LOCK.json
      // pins the same 8c57e46 baseline). It used to hold an OMO->mpd scrub artefact, not a real value.
      source: "8c57e46", sourceDir: "packages/" + s.src, builtAt: new Date().toISOString(),
      build: ["bun build " + s.entry + " --outdir dist --target node --format esm"],
      externalDeps: resolvedExternals,
      artifact: { file: "cli.js", sha256: sha(join(out, "cli.js")), bytes: builtText.length }
    }, null, 2) + "\n")
    console.log("[build-mcp] " + s.name + " -> " + join(out, "cli.js") + " (" + readFileSync(join(out, "cli.js")).length + " bytes)")
  }
} finally {
  rmSync(work, { recursive: true, force: true })
}
if (brandTotals.artifacts === 0) {
  console.error("[build-mcp] FAIL - brand guard inspected 0 artifacts (an empty scan is not a pass)")
  process.exit(1)
}
if (byteTotals.compared === 0) {
  console.error("[build-mcp] FAIL - brand guard compared 0 artifacts against their committed dists (an empty byte comparison is not a pass)")
  process.exit(1)
}
console.log(`[build-mcp] brand guard (primary): ${byteTotals.compared} artifact(s) byte-compared against the committed dists, ${byteTotals.bytes} byte(s) verified equal`)
console.log(`[build-mcp] brand guard: ${brandTotals.artifacts} artifact(s), ${brandTotals.identifiers} identifier(s) inspected, ${brandTotals.brand} allowlisted brand occurrence(s), 0 foreign`)
console.log("[build-mcp] PASS")
}

// Only build when executed directly: importing this module must stay side-effect-free
// (assertBrandClean is exported for its negative control).
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) main()
