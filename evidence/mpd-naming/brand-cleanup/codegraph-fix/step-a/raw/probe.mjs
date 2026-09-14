// STEP A behavioural probe: drive the REAL serve.js migration entry point in a
// sandboxed HOME and record whether the migration actually writes.
//
// Usage: node probe.mjs <label> <sandboxRoot> <outJson>
// The script seeds <sandboxRoot>/home/.mpd/config.jsonc with a legacy document,
// calls the exported runCodegraphServe() with that sandbox HOME, and records:
//   - the stderr text lines emitted by the server
//   - the config.jsonc bytes before/after
//   - every file created under <sandboxRoot>/home/.mpd
// Run it once against the pre-fix artifact (RED) and once against the fixed one
// (GREEN); the write set is the acceptance subject, not "it parses".
import { Readable } from "node:stream"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"

const [label, sandboxRoot, outJson, modeFlag] = process.argv.slice(2)
if (!label || !sandboxRoot || !outJson) {
  console.error("usage: node probe.mjs <label> <sandboxRoot> <outJson> [no-marker|mpd-disabled|codex-disabled|legacy-schema]")
  process.exit(2)
}
const seededNoMarker = modeFlag === "no-marker" || modeFlag === "mpd-disabled" || modeFlag === "codex-disabled"

const repoRoot = "/root/dshProj/my-power-dsh"
// ABSOLUTE paths: the migration writer compares the source path against the
// target path by string identity, and a relative sandbox root makes a source and
// its own target look different while still resolving to one inode.
const home = resolve(join(sandboxRoot, "home"))
const project = resolve(join(sandboxRoot, "project"))
const mpdDir = join(home, ".mpd")
const configPath = join(mpdDir, "config.jsonc")

mkdirSync(mpdDir, { recursive: true })
mkdirSync(project, { recursive: true })

// The seeded document varies with the mode so the same probe can assert the
// STEP B retarget: the project-owned block is `[mpd]`, and a foreign `[codex]`
// block must be inert.
const asJsonc = (obj) => `// MPD configuration (seeded for probe)\n${JSON.stringify(obj, null, 2)}\n`
const base = {
  codegraph: { enabled: true, auto_provision: false },
  legacy_migrations: { projects: ["seeded-legacy.jsonc"] }
}
let seededDoc
if (modeFlag === "mpd-disabled")
  seededDoc = { ...base, "[mpd]": { codegraph: { enabled: false } } }
else if (modeFlag === "codex-disabled")
  seededDoc = { ...base, "[codex]": { codegraph: { enabled: false } } }
else if (modeFlag === "legacy-schema")
  // A config written by the previous release: it carries the foreign schema URL
  // and must still validate (the migration stops WRITING it, not reading it).
  seededDoc = { ...base, $schema: "https://example.invalid/omo.schema.json" }
else if (!seededNoMarker)
  seededDoc = { ...base, _migrations: ["2026-07-codex-config-jsonc"] }
else
  seededDoc = base
const seeded = asJsonc(seededDoc)
writeFileSync(configPath, seeded)

// Isolate BOTH the option-level home and the process env: serve.js resolves the
// home a second time from env.HOME (resolveHomeDir) and the account home from
// userInfo(), so HOME must be pinned for the duration of the run.
const previousHome = process.env.HOME
process.env.HOME = home
for (const key of ["MPD_CODEGRAPH_BIN", "MPD_CODEGRAPH_PROJECT_CWD", "MPD_CODEGRAPH_SESSION_START_CWD", "CODEGRAPH_INSTALL_DIR"]) {
  delete process.env[key]
}
// A path-looking sentinel keeps the resolver on its env-pin route, so nothing is
// provisioned and no network/download path is entered.
process.env.MPD_CODEGRAPH_BIN = "/nonexistent/mpd-codegraph-probe-unavailable"

const stderrLines = []
const debugLines = []
const fakeStderr = { write: (chunk) => { stderrLines.push(String(chunk)); return true } }

const snapshots = {}
function snapshot(tree) {
  const out = {}
  const prefix = tree.endsWith("/") ? tree : tree + "/"
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry)
      if (statSync(p).isDirectory()) walk(p)
      else out[p.startsWith(prefix) ? p.slice(prefix.length) : p] = statSync(p).size + "B"
    }
  }
  if (existsSync(tree)) walk(tree)
  return out
}

snapshots.before = snapshot(mpdDir)

// The migration inside getCodexMpdConfig writes its warning into the returned
// config object, which runCodegraphServe never reads; capture it by wrapping the
// module's own process.stderr so any diagnostic the migration emits is recorded.
const realStderrWrite = process.stderr.write.bind(process.stderr)
process.stderr.write = (chunk, ...rest) => {
  debugLines.push("[process.stderr] " + String(chunk).trimEnd())
  return realStderrWrite(chunk, ...rest)
}

let exitCode = null
let thrown = null
let serve = null
const artifact = resolve(
  process.env.PROBE_ARTIFACT ?? join(repoRoot, "packages/mpd-mcp-codegraph/dist/serve.js")
)
try {
  serve = await import(pathToFileURL(artifact).href)
  exitCode = await serve.runCodegraphServe({
    cwd: project,
    env: process.env,
    homeDir: home,
    stderr: fakeStderr,
    stdin: Readable.from([]),
    stdout: { write: () => true }
  })
} catch (error) {
  thrown = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
}
if (previousHome === undefined) delete process.env.HOME
else process.env.HOME = previousHome
process.stderr.write = realStderrWrite

snapshots.after = snapshot(mpdDir)

const result = {
  label,
  serve_artifact: artifact,
  serve_sha256_at_run: createHash("sha256").update(readFileSync(artifact)).digest("hex"),
  sandbox: { home, project, configPath },
  exit_code: exitCode,
  thrown,
  stderr_lines: stderrLines,
  debug_lines: debugLines,
  seeded_home_files: snapshot(home),
  warnings_dead_path: (debugLines.length > 0 ? debugLines : stderrLines).filter((line) => /configuration migration|migration threw/.test(line)),
  skipped_hint: stderrLines.filter((line) => /CodeGraph MCP skipped/.test(line)),
  config_before: seeded,
  config_after: existsSync(configPath) ? readFileSync(configPath, "utf8") : null,
  config_bytes_before: seeded.length,
  config_bytes_after: existsSync(configPath) ? statSync(configPath).size : null,
  config_exists_after: existsSync(configPath),
  mpd_tree_before: snapshots.before,
  mpd_tree_after: snapshots.after,
  mpd_tree_created: Object.keys(snapshots.after).filter((k) => !(k in snapshots.before)),
  config_rewritten: existsSync(configPath) && readFileSync(configPath, "utf8") !== seeded
}
writeFileSync(outJson, JSON.stringify(result, null, 2) + "\n")
console.log(JSON.stringify({ label, exit_code: exitCode, warnings: result.warnings_dead_path, created: result.mpd_tree_created }, null, 2))
