#!/usr/bin/env node
// Case preset-conformance: the `mpd` agent preset must MOUNT on the installed
// harness, and every harness-owned row config in this repo must still mean what
// the INSTALLED harness says it means.
//
// Why this case exists (measured 2026-09-11, harness 0.1.5-rc.1 + rc.2 packages):
// the preset's persona row still carried the single-key `text:` form that
// `@deepseek-ai/dsh-persona` accepted through 0.1.2-rc.1. From 0.1.3-alpha.2 the
// row was split into the deployment persona prefix/suffix sections and `prefix`
// became REQUIRED, so the row stopped applying — and because `dsh-agent-presets`
// refuses to mount a standing composition with an inactive row, EVERY mpd
// session failed to start:
//   agent-preset/invalid: agent-presets: preset "mpd" failed to mount:
//   failed to apply loader entry persona (@deepseek-ai/dsh-persona): invalid
//   config: - $.prefix missing required value (at prefix)
// No existing gate saw it: `--dump-config` composes rows without executing plugin
// code, `resolve()`/`agentPresets.list` parse the composition for YAML shape and
// row resolvability only (config schemas are validated at MOUNT), and every QA
// case that boots a profile never created a session on the preset.
//
// The case therefore has two halves:
//   1) --self-test (offline): every `@deepseek-ai/*` row config in
//      `presets/mpd/agent.cordis.yml`, the bundle patch and the QA overlays is
//      checked against the INSTALLED packages' own schemas — required keys must
//      be satisfied AND no key may be unknown (schemastery DROPS unknown keys
//      silently, so `persona:`-style drift loses a capability without an error);
//      plus row-id PARITY between `presets/mpd` and the installed shipped
//      `standard` preset, because the harness moves rows between the host and
//      preset planes between releases;
//   2) real run: an isolated DSH_HOME + HOME boots the web profile from THIS
//      checkout and creates a session with `agentPreset: "mpd"` over the
//      gateway — `session/create` mounts the preset and refuses on any inactive
//      row, so a `ok: true` answer is the mount proof. A NEGATIVE CONTROL boots
//      the same sandbox against a copy of the preset whose persona row is
//      rewritten back to `text:` and asserts the mount really fails, so the
//      positive assertion is falsifiable rather than vacuous.
// Evidence -> evidence/dsh-qa/preset-conformance/<ts>/. Never touches the real ~/.dsh.
import { spawn } from "node:child_process"
import { createServer } from "node:net"
import { cpSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync, readdirSync } from "node:fs"
import { createRequire } from "node:module"
import { homedir, tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { assertSessionsSandboxed, sandboxWorkspace } from "./lib/workspace-isolation.mjs"
import { seedSandboxCredentials } from "./lib/credentials.mjs"
import { DSH_MISSING, dshAppSpec } from "./lib/dsh-launcher.mjs"

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))
const PORT = Number(process.env.MPD_QA_PRESET_PORT ?? 3198)
const PRESET_DIR = join(ROOT, "presets", "mpd")
const AUDITED = [
  "presets/mpd/agent.cordis.yml",
  "packages/mpd-bundle/cordis.patch.yml",
]
// Every overlay QA can hand to `dsh --patch`; a stale key here silently drops a
// capability from the case that uses it, exactly like the preset drift.
const OVERLAY_DIR = join(ROOT, "tests", "overlays")
const HARNESS_ROW_PREFIX = "@deepseek-ai/"

function fail(message) { console.error("[preset-conformance] FAIL: " + message); process.exit(1) }

/** Is `dir` the installed harness package (the one that owns node_modules)? */
function isHarnessPackage(dir) {
  try { return JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).name === "@deepseek-ai/dsh" } catch { return false }
}

/**
 * The PATH-resolved `dsh` launcher — resolved in-process, WITHOUT `sh`.
 *
 * `sh -c "command -v dsh"` is a POSIX-only shape: on Windows the `sh` that answers is Git
 * Bash / MSYS, and it prints a POSIX path (`/c/Users/<user>/AppData/Roaming/npm/dsh`) that
 * `realpathSync` cannot resolve (measured: `ENOENT: lstat 'C:\c'`, which took the whole case
 * down). The PATH scan below is the platform-native equivalent and needs no shell at all.
 */
function whichDsh() {
  const dirs = (process.env.PATH ?? "").split(process.platform === "win32" ? ";" : ":")
  const names = process.platform === "win32" ? ["dsh.cmd", "dsh.exe", "dsh.bat", "dsh"] : ["dsh"]
  for (const dir of dirs) {
    if (dir === "") continue
    for (const name of names) {
      const candidate = join(dir, name)
      if (existsSync(candidate)) return candidate
    }
  }
  return ""
}

/**
 * Absolute path of the installed `dsh` harness root (the package that owns node_modules).
 *
 * The POSIX shape is a symlink chain — `realpath(bin)` lands INSIDE the package, so two
 * `dirname` hops reach its root. npm's Windows launcher is NOT that: `<prefix>\dsh.cmd` is a
 * shim whose `..` is the npm prefix, so the same two hops answer `<prefix>` (no `package.json`,
 * no `node_modules`) and every schema lookup would read as "unresolved". The owning package is
 * therefore located by WALKING UP for either the package itself (name `@deepseek-ai/dsh`) or
 * the npm prefix's `node_modules/@deepseek-ai/dsh` child, whichever the layout offers.
 */
function harnessRoot() {
  const bin = whichDsh()
  if (bin === "") return ""
  let real = ""
  try { real = realpathSync(bin) } catch { return "" }
  let dir = dirname(real)
  for (let i = 0; i < 8; i++) {
    if (isHarnessPackage(dir)) return dir
    const nested = join(dir, "node_modules", "@deepseek-ai", "dsh")
    if (isHarnessPackage(nested)) return nested
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return ""
}

/** js-yaml resolved from the installed harness (no repo dependency). */
function yamlLoader(root) {
  const req = createRequire(join(root, "package.json"))
  const yaml = req("js-yaml")
  const jsTag = new yaml.Type("tag:yaml.org,2002:js", { kind: "scalar", construct: (data) => ({ __jsExpr: data }) })
  return (text) => yaml.load(text, { schema: yaml.DEFAULT_SCHEMA.extend([jsTag]) })
}

/** Flatten one composition/patch document into its plugin rows (insert lists + groups). */
function flattenRows(rows, out = []) {
  if (!Array.isArray(rows)) return out
  for (const row of rows) {
    if (row === null || typeof row !== "object") continue
    if (Array.isArray(row.insert)) flattenRows(row.insert, out)
    if (row.group === true && Array.isArray(row.config)) { flattenRows(row.config, out); continue }
    if (typeof row.name === "string") out.push(row)
  }
  return out
}

/** Allowed top-level keys of one schemastery schema, one set per union branch. */
function allowedKeySets(schema) {
  if (schema === undefined || schema === null || typeof schema !== "function") return []
  const list = Array.isArray(schema.list) ? schema.list : [schema]
  const sets = []
  for (const branch of list) {
    if (branch?.dict !== undefined && typeof branch.dict === "object") sets.push(new Set(Object.keys(branch.dict)))
  }
  return sets
}

/**
 * Replace every `!!js` node with a benign string of the type the loader would
 * produce, so a config that CARRIES expressions is still checked for its static
 * shape (unknown keys, renamed enum values, missing siblings) instead of being
 * skipped whole.
 */
function materialize(value) {
  if (Array.isArray(value)) return value.map(materialize)
  if (value === null || typeof value !== "object") return value
  if (value.__jsExpr !== undefined) return "expression"
  const out = {}
  for (const [key, entry] of Object.entries(value)) out[key] = materialize(entry)
  return out
}

/** The installed package that owns a row's specifier. */
function packageOf(specifier) {
  const parts = specifier.split("/")
  return parts.length >= 2 && specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]
}

async function loadSchema(root, packageName, cache) {
  if (cache.has(packageName)) return cache.get(packageName)
  // "unresolved" (no installed package) is a hole in the audit; "schema-free"
  // (a row whose plugin declares no Config at all) is a legitimate answer.
  let state = { kind: "unresolved" }
  const entry = join(root, "node_modules", packageName, "lib", "index.js")
  if (existsSync(entry)) {
    state = { kind: "schema-free" }
    try {
      // pathToFileURL: node's ESM loader rejects a bare Windows path
      // (`ERR_UNSUPPORTED_ESM_URL_SCHEME: received protocol 'c:'`); POSIX paths pass either way.
      const mod = await import(pathToFileURL(entry).href)
      const candidates = [mod.Config, mod.default?.Config]
      for (const value of Object.values(mod)) {
        if (typeof value === "function" && value.Config !== undefined) candidates.push(value.Config)
      }
      const schema = candidates.find((value) => value !== undefined && allowedKeySets(value).length > 0)
      if (schema !== undefined) state = { kind: "schema", schema }
    } catch { state = { kind: "unresolved" } }
  }
  cache.set(packageName, state)
  return state
}

/**
 * Check one document's harness-owned rows against the installed schemas.
 * @returns {{checked: number, schemaFree: number, unchecked: string[], problems: string[]}}
 */
async function checkDocument(root, absPath, yamlLoad, cache) {
  const rows = flattenRows(yamlLoad(readFileSync(absPath, "utf8")))
  const problems = []
  const unchecked = []
  let checked = 0
  let schemaFree = 0
  for (const row of rows) {
    if (row.disabled === true) continue
    if (!row.name.startsWith(HARNESS_ROW_PREFIX)) continue
    const packageName = packageOf(row.name)
    const state = await loadSchema(root, packageName, cache)
    if (state.kind === "unresolved") { unchecked.push(`${row.id ?? row.name} (${packageName})`); continue }
    if (state.kind === "schema-free") { schemaFree += 1; continue }
    const schema = state.schema
    // `!!js` nodes are evaluated by the loader before validation, so they are
    // materialized to a benign string and the STATIC shape is still checked.
    const config = materialize(row.config ?? {})
    checked += 1
    try { schema(config) } catch (error) {
      problems.push(`${row.id ?? row.name} (${row.name}): ${String(error.message).split("\n")[0]}`)
      continue
    }
    const sets = allowedKeySets(schema)
    const unknown = Object.keys(config).filter((key) => !sets.some((set) => set.has(key)))
    if (unknown.length > 0) {
      problems.push(`${row.id ?? row.name} (${row.name}): unknown config key(s) ${unknown.join(", ")} — schemastery keeps them and the row silently loses the setting`)
    }
  }
  return { checked, schemaFree, unchecked, problems }
}

/** The installed shipped `standard` preset's row ids — the parity reference. */
function standardRowIds(root) {
  const file = join(root, "node_modules", "@deepseek-ai", "dsh-agent-presets", "presets", "standard", "agent.cordis.yml")
  if (!existsSync(file)) return null
  const ids = []
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const match = /^\s*- id: (\S+)/.exec(line)
    if (match !== null) ids.push(match[1])
  }
  return ids
}

function presetRowIds(dir) {
  const ids = []
  for (const line of readFileSync(join(dir, "agent.cordis.yml"), "utf8").split("\n")) {
    const match = /^\s*- id: (\S+)/.exec(line)
    if (match !== null) ids.push(match[1])
  }
  return ids
}

async function conformance() {
  const root = harnessRoot()
  if (root === "") return { ok: false, problems: ["the installed dsh harness could not be resolved (dsh not on PATH)"] }
  const yamlLoad = yamlLoader(root)
  const cache = new Map()
  const files = [...AUDITED]
  if (existsSync(OVERLAY_DIR)) for (const name of readdirSync(OVERLAY_DIR).sort()) if (name.endsWith(".yml")) files.push(join("tests", "overlays", name))
  const problems = []
  const unchecked = []
  let checked = 0
  let schemaFree = 0
  for (const rel of files) {
    const abs = join(ROOT, rel)
    if (!existsSync(abs)) continue
    const result = await checkDocument(root, abs, yamlLoad, cache)
    checked += result.checked
    schemaFree += result.schemaFree
    unchecked.push(...result.unchecked.map((entry) => `${rel}: ${entry}`))
    problems.push(...result.problems.map((entry) => `${rel} :: ${entry}`))
  }
  // Persona contract: the positive rule the incident violated.
  const personaRow = flattenRows(yamlLoad(readFileSync(join(PRESET_DIR, "agent.cordis.yml"), "utf8")))
    .find((row) => row.id === "persona")
  if (personaRow === undefined) problems.push("presets/mpd/agent.cordis.yml :: the persona row is missing")
  else {
    const keys = Object.keys(personaRow.config ?? {})
    if (!keys.includes("prefix")) problems.push("presets/mpd/agent.cordis.yml :: the persona row has no `prefix` key (required by dsh-persona from 0.1.3-alpha.2)")
    if (keys.includes("text")) problems.push("presets/mpd/agent.cordis.yml :: the persona row still carries the retired `text` key")
  }
  // Row parity with the installed shipped standard preset.
  const reference = standardRowIds(root)
  let parity = null
  if (reference === null) problems.push("the installed harness ships no `standard` preset — cannot check row parity")
  else {
    const ours = presetRowIds(PRESET_DIR)
    const missing = reference.filter((id) => !ours.includes(id))
    const extra = ours.filter((id) => !reference.includes(id))
    parity = { reference: reference.length, ours: ours.length, missing, extra }
    if (missing.length > 0) problems.push(`presets/mpd/agent.cordis.yml is missing row(s) the installed standard preset mounts: ${missing.join(", ")}`)
    if (extra.length > 0) problems.push(`presets/mpd/agent.cordis.yml mounts row(s) the installed standard preset does not: ${extra.join(", ")}`)
  }
  return { ok: problems.length === 0, harnessRoot: root, checked, schemaFree, unchecked, parity, problems }
}

async function selfTest() {
  const root = harnessRoot()
  if (root === "") fail("self-test: dsh is not on PATH — the case cannot verify the installed harness")
  // Guard against a vacuous pass: this case exists because the persona row's
  // contract changed, so the installed harness must really require `prefix`.
  const yamlLoad = yamlLoader(root)
  const personaState = await loadSchema(root, "@deepseek-ai/dsh-persona", new Map())
  if (personaState.kind !== "schema") fail("self-test: the installed @deepseek-ai/dsh-persona exposes no config schema (" + personaState.kind + ")")
  const persona = personaState.schema
  const keySets = allowedKeySets(persona)
  const keys = [...new Set(keySets.flatMap((set) => [...set]))]
  if (!keys.includes("prefix")) fail("self-test: the installed dsh-persona schema has no `prefix` key: " + keys.join(","))
  if (keys.includes("text")) fail("self-test: the installed dsh-persona still accepts `text` — revisit the preset row form")
  let invalid = false
  try { persona({ text: "x" }) } catch { invalid = true }
  if (!invalid) fail("self-test: the installed dsh-persona accepted a text-only config — the mount failure this case pins cannot happen")
  // The repo's own documents must be clean against those schemas.
  const result = await conformance()
  if (result.problems.length > 0) fail("self-test: conformance problems:\n  - " + result.problems.join("\n  - "))
  if (result.unchecked.length > 0) fail("self-test: row(s) could not be checked against the installed harness: " + result.unchecked.join(", "))
  if (result.checked < 20) fail("self-test: only " + result.checked + " harness row(s) checked — the audit lost its surface")
  // The preset must stay loadable by the harness's own YAML dialect.
  const rows = flattenRows(yamlLoad(readFileSync(join(PRESET_DIR, "agent.cordis.yml"), "utf8")))
  if (rows.length < 25) fail("self-test: the mpd preset exposes only " + rows.length + " rows")
  console.log("[preset-conformance self-test] ok: " + result.checked + " harness rows conform against the installed schemas ("
    + result.schemaFree + " row(s) declare no schema), persona prefix=" + keys.includes("prefix")
    + ", row parity " + result.parity.ours + "/" + result.parity.reference)
}

function makeSandbox(tag, presetRoot) {
  const sandbox = mkdtempSync(join(tmpdir(), "mpd-preset-" + tag + "-"))
  const home = join(sandbox, "home")
  const userHome = join(sandbox, "userhome")
  const profile = join(home, "profiles", "w")
  mkdirSync(join(profile, "node_modules", "@mpd-dsh"), { recursive: true })
  mkdirSync(userHome, { recursive: true })
  const creds = join(homedir(), ".dsh", ".credentials.yaml")
  seedSandboxCredentials(home, { credentialsFile: creds })
  const settings = join(homedir(), ".dsh", "settings.yaml")
  if (existsSync(settings)) cpSync(settings, join(home, "settings.yaml"))
  // A checkout install IS a link: node_modules/@mpd-dsh/mpd -> the repo, which is
  // what `dsh plugin add <repo>` writes and what the bundle exports resolve through.
  symlinkSync(ROOT, join(profile, "node_modules", "@mpd-dsh", "mpd"), "junction")
  writeFileSync(join(profile, "package.json"), JSON.stringify({
    name: "dsh-profile-w", private: true, dependencies: {}, dsh: { profile: { bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "@mpd-dsh/mpd"] } },
  }, null, 2))
  const patches = []
  if (presetRoot !== undefined) {
    // The control lane: id-target the roster row at a mutated preset root so the
    // bundle's own root is replaced (a patch replaces the targeted row's config).
    const overlay = join(sandbox, "control-presets.yml")
    writeFileSync(overlay, [
      "- id: agent-presets",
      "  name: '@deepseek-ai/dsh-agent-presets'",
      "  config:",
      "    default: mpd",
      "    roots:",
      "      - path: " + JSON.stringify(presetRoot),
      "        trust: system",
      "",
    ].join("\n"))
    patches.push("--patch", overlay)
  }
  if (join(home).startsWith(join(homedir(), ".dsh"))) fail("isolation assertion: DSH_HOME points at the real home")
  // Workspace isolation: sessions must be created inside a sandbox workspace, never
  // with the real checkout as their cwd (DSH_HOME/HOME do not cover workspace state).
  const ws = sandboxWorkspace(sandbox)
  return { sandbox, home, userHome, profile, ws, patches, env: { ...process.env, DSH_HOME: home, HOME: userHome } }
}

/**
 * Fail fast when the sandbox port is already taken.
 *
 * MEASURED (2026-09-22): a crashed run left its web app behind on 3198 and the NEXT run then died
 * inside the harness's own loader (`EADDRINUSE` -> `failed to apply loader entry webserver`) with
 * no `token=` line, so this lane spent its whole budget and reported an unauthorized
 * `session/create` plus a vacuous negative control - ninety seconds of symptoms for a one-line
 * cause. `MPD_QA_PRESET_PORT` picks another port.
 */
async function assertPortFree(port) {
  const taken = await new Promise((resolve) => {
    const probe = createServer()
    probe.once("error", () => resolve(true))
    probe.once("listening", () => probe.close(() => resolve(false)))
    probe.listen(port, "127.0.0.1")
  })
  if (taken) fail("port " + port + " is already in use: a previous run's web app is still alive (kill it) or set MPD_QA_PRESET_PORT to a free port")
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Redact the process launch token the Web app prints in its URL line. Evidence
 * logs are committed (AGENTS.md §10), and although the token belongs to an
 * already-disposed sandbox process, no credential-shaped string belongs in a
 * committed artifact.
 */
function redact(text) {
  return text.replace(/token=[A-Za-z0-9_-]+/g, "token=<redacted>")
}

/** Every web app this lane booted, so the CLI can never leave one holding its port. */
const BOOTED = []

/** Boot one sandbox and return its log path, token/cookie and the child handle. */
async function boot(sandbox, logPath) {
  const fd = openSync(logPath, "w")
  // Launcher flags (`--patch`) come BEFORE the profile app's own flags: the
  // launcher hands everything after its first unrecognized argument to the app.
  // The launcher is spawned by its RESOLVED path: a bare `dsh` is not portable (npm installs a
  // `.cmd` shim on win32 and node refuses that without a shell - measured 2026-09-22: the whole
  // lane died with `spawn dsh ENOENT` before this).
  const spec = dshAppSpec(["--profile", "w", ...sandbox.patches, "--port", String(PORT), "--no-open"], sandbox.env)
  if (spec === null) fail(DSH_MISSING)
  const child = spawn(spec.command, spec.args, {
    env: sandbox.env, cwd: sandbox.ws, stdio: ["ignore", fd, fd],
  })
  BOOTED.push(child)
  const readLog = () => { try { return readFileSync(logPath, "utf8") } catch { return "" } }
  let token = ""
  let cookie = ""
  const deadline = Date.now() + 90000
  while (Date.now() < deadline) {
    await sleep(1500)
    const match = /token=([A-Za-z0-9_-]+)/.exec(readLog())
    if (match !== null) token = match[1]
    if (token === "") continue
    try {
      const authorize = await fetch(`http://127.0.0.1:${PORT}/?token=${token}`, { redirect: "manual", signal: AbortSignal.timeout(8000) })
      cookie = (authorize.headers.getSetCookie?.() ?? []).map((value) => value.split(";")[0]).join("; ") || cookie
      const root = await fetch(`http://127.0.0.1:${PORT}/`, { headers: cookie === "" ? {} : { cookie }, signal: AbortSignal.timeout(8000) })
      if (cookie !== "" && root.status === 200) break
    } catch { /* not serving yet */ }
  }
  return { child, readLog, token, cookie }
}

/** Create one session through the gateway's own RPC envelope, inside the sandbox workspace. */
async function createSession(cookie, presetId, cwd) {
  const rpcId = "preset-conformance-" + String(Date.now())
  const response = await fetch(`http://127.0.0.1:${PORT}/api/session/create`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie === "" ? {} : { cookie }) },
    body: JSON.stringify({
      type: "client-request", rpcId, method: "session/create",
      payload: { args: { request: { cwd, agentPreset: presetId } } },
    }),
    signal: AbortSignal.timeout(60000),
  }).catch((error) => ({ status: 0, json: async () => ({ transport: String(error?.cause?.code ?? error?.message ?? error) }) }))
  // The server does NOT always answer JSON: an unauthenticated call answers the plain text
  // `unauthorized`, and `await response.json()` then threw an unhandled SyntaxError that killed the
  // lane (measured 2026-09-22) - so the lane reported NOTHING about the boot it had just made. The
  // body is read as TEXT and surfaced in the step instead, whatever its shape.
  const raw = await response.text().catch(() => "")
  let envelope = null
  try { envelope = JSON.parse(raw) } catch { envelope = null }
  return { status: response.status, result: envelope?.result ?? null, transport: envelope?.transport ?? null, raw: raw.slice(0, 400) }
}

async function stop(child) {
  try { child.kill("SIGTERM") } catch { /* already gone */ }
  await sleep(1500)
  try { child.kill("SIGKILL") } catch { /* already gone */ }
  // BEST EFFORT, win32 only: when the fallback interpreter spec was used the app is a CHILD of
  // cmd.exe and survives the two kills above, still holding the port (measured 2026-09-22). `/T`
  // takes the tree; a caller whose policy forbids taskkill simply keeps the old behaviour.
  if (process.platform === "win32" && typeof child.pid === "number") {
    try { spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" }) } catch { /* denied: the direct-child path needs no tree kill */ }
  }
}

/** The mount-failure signatures a row that does not apply leaves in the boot log. */
const FAILURE_SIGNATURES = ["invalid config", "failed to apply loader entry", "agent-preset/invalid", "did not activate"]

async function runReal() {
  await assertPortFree(PORT)
  const ts = new Date().toISOString().replaceAll(":", "-")
  const outDir = join(ROOT, "evidence", "dsh-qa", "preset-conformance", ts)
  mkdirSync(outDir, { recursive: true })
  const conformanceResult = await conformance()
  const steps = { conformance: { ok: conformanceResult.ok, checked: conformanceResult.checked, schemaFree: conformanceResult.schemaFree, parity: conformanceResult.parity, problems: conformanceResult.problems } }

  // ── positive lane: the shipped preset must mount for a real session ────────
  const sandbox = makeSandbox("main")
  const logPath = join(outDir, "boot.log")
  const web = await boot(sandbox, logPath)
  steps.auth = { ok: web.token !== "" && web.cookie !== "", tokenSeen: web.token !== "", cookieSession: web.cookie !== "" }
  const created = await createSession(web.cookie, "mpd", sandbox.ws)
  const value = created.result?.value ?? null
  steps.sessionCreate = {
    ok: created.result?.ok === true && value?.agentPreset === "mpd",
    status: created.status,
    error: created.result?.ok === false ? created.result.error : undefined,
    sessionId: value?.sessionId ?? null,
    agentPreset: value?.agentPreset ?? null,
    raw: created.raw ?? null,
  }
  // Durable record: the session header names the preset it was composed from.
  let headerPreset = null
  let headerPath = null
  if (typeof value?.sessionId === "string") {
    const sessionsRoot = join(sandbox.home, "sessions")
    // Durability is throttled, so the header may land a moment after creation.
    for (let attempt = 0; attempt < 15 && headerPreset === null; attempt++) {
      for (const workspace of existsSync(sessionsRoot) ? readdirSync(sessionsRoot) : []) {
        const candidate = join(sessionsRoot, workspace, value.sessionId, "session.v3.jsonl.zstd")
        if (!existsSync(candidate)) continue
        const { zstdDecompressSync } = await import("node:zlib")
        let text = ""
        try { text = zstdDecompressSync(readFileSync(candidate)).toString("utf8") } catch { continue }
        headerPath = candidate
        headerPreset = /"agentPreset":"([^"]+)"/.exec(text)?.[1] ?? null
        if (headerPreset !== null) break
      }
      if (headerPreset === null) await sleep(1000)
    }
  }
  steps.sessionHeader = { ok: headerPreset === "mpd", agentPreset: headerPreset, log: headerPath }
  const bootLog = web.readLog()
  const signatures = FAILURE_SIGNATURES.filter((needle) => bootLog.includes(needle))
  steps.bootLog = { ok: signatures.length === 0, signatures }
  await stop(web.child)
  // Falsifiable workspace-isolation proof: every session-store key left by this lane
  // must belong to the sandbox workspace, never to the real checkout.
  assertSessionsSandboxed(sandbox.home, sandbox.sandbox, { label: "preset-conformance/main" })

  // ── negative control: the retired `text:` form must really fail to mount ───
  const controlRoot = join(tmpdir(), "mpd-preset-control-" + ts)
  mkdirSync(join(controlRoot, "mpd"), { recursive: true })
  cpSync(PRESET_DIR, join(controlRoot, "mpd"), { recursive: true })
  const controlFile = join(controlRoot, "mpd", "agent.cordis.yml")
  const text = readFileSync(controlFile, "utf8")
  if (!text.includes("    prefix: >-")) fail("control: the preset's persona row does not use the `prefix:` block scalar")
  writeFileSync(controlFile, text.replace("    prefix: >-", "    text: >-"))
  const controlSandbox = makeSandbox("control", controlRoot)
  const controlLog = join(outDir, "control-boot.log")
  const controlWeb = await boot(controlSandbox, controlLog)
  const controlCreated = await createSession(controlWeb.cookie, "mpd", controlSandbox.ws)
  const controlError = controlCreated.result?.ok === false ? controlCreated.result.error : null
  steps.negativeControl = {
    ok: controlError?.code === "agent-preset/invalid" && String(controlError.message).includes("$.prefix missing required value"),
    code: controlError?.code ?? null,
    message: controlError === null ? "the mutated preset mounted — the assertion is not falsifiable" : String(controlError.message).slice(0, 260),
    mutations: ["persona prefix: -> text:"],
  }
  await stop(controlWeb.child)
  assertSessionsSandboxed(controlSandbox.home, controlSandbox.sandbox, { label: "preset-conformance/control" })
  rmSync(controlRoot, { recursive: true, force: true })

  const allOk = Object.values(steps).every((step) => step.ok)
  // Redact the launch-token URL lines the boot writes into the redirected logs.
  for (const name of ["boot.log", "control-boot.log"]) {
    const path = join(outDir, name)
    if (existsSync(path)) writeFileSync(path, redact(readFileSync(path, "utf8")))
  }
  writeFileSync(join(outDir, "result.json"), JSON.stringify({
    ok: allOk,
    harnessRoot: conformanceResult.harnessRoot,
    note: "session/create mounts the mpd preset and refuses on any inactive row, so its ok answer is the mount proof; the negative control boots the same sandbox with the retired `text:` persona form and must fail.",
    steps,
  }, null, 2))
  writeFileSync(join(outDir, "output.log"), redact("--- main boot ---\n" + bootLog.slice(-8000) + "\n--- control boot ---\n" + controlWeb.readLog().slice(-8000)))
  console.log("[preset-conformance] ok=" + allOk + " -> " + outDir)
  for (const [key, step] of Object.entries(steps)) console.log("  " + key + ": " + JSON.stringify(step).slice(0, 300))
  if (!allOk) process.exit(1)
  console.log("[preset-conformance] PASS")
}

const argv = process.argv.slice(2)
if (argv.includes("--self-test")) await selfTest()
else {
  // A live lane must never leave its web app behind: the child holds the port, and the NEXT boot in
  // the same run (the negative control) then dies with EADDRINUSE - measured 2026-09-22, after a step
  // threw and no `stop()` was ever reached. Whatever happens, the booted children die here.
  try {
    await runReal()
  } catch (error) {
    console.error("[preset-conformance] FAIL: " + String(error?.stack ?? error).slice(0, 2000))
    process.exitCode = 1
  } finally {
    for (const child of BOOTED) {
      try { child.kill("SIGKILL") } catch { /* already gone */ }
    }
  }
}
