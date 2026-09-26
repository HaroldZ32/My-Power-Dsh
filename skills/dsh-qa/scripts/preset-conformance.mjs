#!/usr/bin/env node
// Case preset-conformance: the `mpd` agent preset must MOUNT on the installed
// harness, and every harness-owned row config in this repo must still mean what
// the INSTALLED harness says it means.
//
// Why this case exists (measured 2026-09-11, harness 0.1.5-rc.1 + rc.2 packages):
// the preset's persona row still carried the single-key `text:` form that
// `@deepseek-ai/dsh-persona` accepted through 0.1.2-rc.1. From 0.1.3-alpha.2 the
// row was split into the deployment persona prefix/suffix sections and `prefix`
// became REQUIRED, so the row stopped applying — and because the preset registry
// refuses to mount a standing composition with an inactive row, EVERY mpd
// session failed to start:
//   agent-preset/invalid: preset "mpd" failed to mount:
//   failed to apply loader entry persona (@deepseek-ai/dsh-persona): invalid
//   config: - $.prefix missing required value (at prefix)
// No existing gate saw it: `--dump-config` composes rows without executing plugin
// code, the preset roster parses the composition for YAML shape and row
// resolvability only (config schemas are validated at MOUNT), and every QA case
// that boots a profile never created a session on the preset.
//
// 0.1.7-rc.2 MODEL CHANGE (this file's rebase, measured against the installed
// package tree): `@deepseek-ai/dsh-agent-presets` NO LONGER EXISTS. A preset is
// no longer a directory of `agent.cordis.yml` served from a root; it is an
// ordinary PLUGIN ROW — `@deepseek-ai/dsh-agent-preset` with
// `config: { id, order?, name?, description?, plugins: [<inline entry list>] }` —
// and `@deepseek-ai/dsh-agent-preset-registry` holds only the deployment
// `default`. This bundle ships those two rows in TWO patch files, declared as an
// ARRAY by the root manifest's `dsh.bundle.patch`:
//   packages/mpd-bundle/cordis.patch.yml   id-targets `agent-preset-registry` -> default: mpd
//   presets/mpd.patch.yml                  the `preset-mpd` row + its inline child list
// Every path below is therefore DERIVED from that one declaration (the same
// declaration the loader reads), never from a hardcoded file name.
//
// The case therefore has two halves:
//   1) --self-test (offline): every `@deepseek-ai/*` row config declared by the
//      manifest's patch array — INCLUDING the children inside a preset row's
//      `config.plugins`, where the whole mpd composition now lives — plus the QA
//      overlays is checked against the INSTALLED packages' own schemas: required
//      keys must be satisfied AND no key may be unknown (schemastery DROPS
//      unknown keys silently, so `persona:`-style drift loses a capability
//      without an error); plus row-id PARITY between the `mpd` preset row's
//      children and the shipped `standard` preset's, because the harness moves
//      rows between the host and preset planes between releases;
//   2) real run: an isolated DSH_HOME + HOME boots the web profile from THIS
//      checkout and creates a session with `agentPreset: "mpd"` over the
//      gateway — `session/create` mounts the preset and refuses on any inactive
//      row, so a `ok: true` answer is the mount proof. A NEGATIVE CONTROL boots
//      the same sandbox with a `--patch` override that rewrites the `preset-mpd`
//      row's persona back to the retired `text:` form and asserts the mount
//      really fails, so the positive assertion is falsifiable rather than
//      vacuous.
// Evidence -> evidence/dsh-qa/preset-conformance/<ts>/. Never touches the real ~/.dsh.
import { spawn, spawnSync } from "node:child_process"
import { createServer } from "node:net"
import { cpSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { homedir, tmpdir } from "node:os"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { assertSessionsSandboxed, sandboxWorkspace } from "./lib/workspace-isolation.mjs"
import { seedSandboxCredentials } from "./lib/credentials.mjs"
import { DSH_MISSING, dshAppSpec } from "./lib/dsh-launcher.mjs"

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))
const PORT = Number(process.env.MPD_QA_PRESET_PORT ?? 3198)
const MANIFEST = join(ROOT, "package.json")
// The preset row's plugin specifier: `@deepseek-ai/dsh-agent-preset`. The
// REGISTRY row is `@deepseek-ai/dsh-agent-preset-registry` — a different id that
// a suffix test would confuse, so rows are matched by packageOf(), never by a
// `endsWith` on the specifier.
const PRESET_ROW_PACKAGE = "@deepseek-ai/dsh-agent-preset"
const REFERENCE_PRESET = "standard"
const PRESET_ID = "mpd"
const OVERLAY_DIR = join(ROOT, "tests", "overlays")
const HARNESS_ROW_PREFIX = "@deepseek-ai/"

function fail(message) { console.error("[preset-conformance] FAIL: " + message); process.exit(1) }

/** The bundle patch files, from the ONE declaration the loader itself reads (string OR array). */
function declaredBundlePatches(root = ROOT, manifestPath = MANIFEST) {
  let raw
  try { raw = JSON.parse(readFileSync(manifestPath, "utf8"))?.dsh?.bundle?.patch } catch { return [] }
  const list = Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : []
  return list.filter((value) => typeof value === "string" && value.trim() !== "").map((value) => resolve(root, value))
}

/** Every overlay QA can hand to `dsh --patch`; a stale key here silently drops a capability. */
function overlayFiles() {
  if (!existsSync(OVERLAY_DIR)) return []
  return readdirSync(OVERLAY_DIR).filter((name) => name.endsWith(".yml")).sort().map((name) => join(OVERLAY_DIR, name))
}

/** Repo-relative label when the file is inside the checkout, else the absolute path. */
function label(file) {
  const rel = relative(ROOT, file)
  return rel === "" || rel.startsWith("..") ? file : rel
}

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

/**
 * Every row a patch document declares: its top-level rows PLUS the children of
 * every preset declaration, because a preset's composition now lives inline in
 * `config.plugins` and the incident this case pins happened INSIDE that list.
 * Flattening only the top level would silently stop auditing the whole mpd
 * composition — the exact hole the retired directory form never had.
 */
function documentRows(doc) {
  const top = flattenRows(doc)
  const presetChildren = []
  for (const row of top) if (Array.isArray(row.config?.plugins)) presetChildren.push(...flattenRows(row.config.plugins))
  return { top, presetChildren, all: [...top, ...presetChildren] }
}

/** The preset declaration of one id among the audited documents, with its inline child rows. */
function findPresetDeclaration(docs, presetId) {
  for (const doc of docs) {
    for (const row of flattenRows(doc.value)) {
      if (packageOf(row.name) !== PRESET_ROW_PACKAGE) continue
      if (row.config?.id !== presetId) continue
      return { doc, row, children: flattenRows(row.config.plugins) }
    }
  }
  return null
}

/**
 * The installed shipped preset of a given id, discovered from the harness's own
 * `presets/*.patch.yml` files (0.1.7-rc.2 ships standard/ptc/minimal/cordis under
 * `@deepseek-ai/dsh-web-app`). Returns null when no installed package supplies it.
 */
function shippedPreset(root, presetId, yamlLoad) {
  const candidates = []
  const modules = join(root, "node_modules", "@deepseek-ai")
  if (existsSync(modules)) {
    for (const name of readdirSync(modules).sort()) {
      const dir = join(modules, name, "presets")
      if (!existsSync(dir)) continue
      for (const file of readdirSync(dir).sort()) if (file.endsWith(".patch.yml")) candidates.push(join(dir, file))
    }
  }
  for (const file of candidates) {
    let doc = null
    try { doc = yamlLoad(readFileSync(file, "utf8")) } catch { continue }
    const found = findPresetDeclaration([{ value: doc, path: file }], presetId)
    if (found !== null) return { file, row: found.row, children: found.children }
  }
  return null
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
  const parts = String(specifier).split("/")
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
 * Check one document's harness-owned rows — top-level AND preset children —
 * against the installed schemas.
 * @returns {{checked: number, schemaFree: number, unchecked: string[], problems: string[]}}
 */
async function checkDocument(root, absPath, yamlLoad, cache) {
  const { all } = documentRows(yamlLoad(readFileSync(absPath, "utf8")))
  const problems = []
  const unchecked = []
  let checked = 0
  let schemaFree = 0
  for (const row of all) {
    if (row.disabled === true) continue
    if (typeof row.name !== "string" || !row.name.startsWith(HARNESS_ROW_PREFIX)) continue
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

/** A row is ACTIVE unless it carries the literal `disabled: true`. A `!!js` guard stays active. */
const isActive = (row) => row.disabled !== true

/** Rows that declare an `id` (the loader may assign one when a row omits it). */
const idOf = (row) => (typeof row.id === "string" ? row.id : null)

/**
 * The whole offline contract, parameterized so `--self-test` can drive SEEDED
 * mutations through the SAME code path the live run uses.
 * @param {{patchFiles?: string[], auditFiles?: string[]}} [opts]
 */
async function conformance(opts = {}) {
  const root = harnessRoot()
  if (root === "") return { ok: false, problems: ["the installed dsh harness could not be resolved (dsh not on PATH)"], unchecked: [], notes: [] }
  const yamlLoad = yamlLoader(root)
  const cache = new Map()
  const patchFiles = opts.patchFiles ?? declaredBundlePatches()
  const auditFiles = opts.auditFiles ?? [...patchFiles, ...overlayFiles()]
  const problems = []
  const unchecked = []
  const notes = []
  let checked = 0
  let schemaFree = 0
  const docs = []
  for (const file of patchFiles) {
    if (!existsSync(file)) { problems.push(`${label(file)} :: declared by package.json dsh.bundle.patch but missing from the checkout`); continue }
    let value = null
    try { value = yamlLoad(readFileSync(file, "utf8")) } catch (error) { problems.push(`${label(file)} :: does not parse as the loader's YAML dialect (${String(error.message).split("\n")[0]})`); continue }
    docs.push({ path: file, value })
  }
  for (const file of auditFiles) {
    if (!existsSync(file)) continue
    const result = await checkDocument(root, file, yamlLoad, cache)
    checked += result.checked
    schemaFree += result.schemaFree
    unchecked.push(...result.unchecked.map((entry) => `${label(file)}: ${entry}`))
    problems.push(...result.problems.map((entry) => `${label(file)} :: ${entry}`))
  }
  // Preset declaration: the mpd composition is an inline child list now, so its
  // ABSENCE is a finding of its own (a patch file that stops declaring it would
  // otherwise make every check below silently vanish).
  const preset = findPresetDeclaration(docs, PRESET_ID)
  let persona = null
  if (preset === null) {
    problems.push(`no '@deepseek-ai/dsh-agent-preset' row with config.id: ${PRESET_ID} in ${patchFiles.map(label).join(", ") || "(no patch file)"} — the mpd preset is not declared at all`)
  } else {
    if (preset.children.length < 25) problems.push(`${label(preset.doc.path)} :: the ${PRESET_ID} preset declares only ${preset.children.length} child row(s)`)
    // Persona contract: the positive rule the incident violated.
    const personaRow = preset.children.find((row) => row.id === "persona")
    if (personaRow === undefined) problems.push(`${label(preset.doc.path)} :: the ${PRESET_ID} preset's persona row is missing`)
    else {
      const keys = Object.keys(personaRow.config ?? {})
      persona = { keys, hasPrefix: keys.includes("prefix"), hasText: keys.includes("text") }
      if (!keys.includes("prefix")) problems.push(`${label(preset.doc.path)} :: the persona row has no \`prefix\` key (required by dsh-persona from 0.1.3-alpha.2)`)
      if (keys.includes("text")) problems.push(`${label(preset.doc.path)} :: the persona row still carries the retired \`text\` key`)
    }
  }
  // Row parity with the installed shipped `standard` preset.
  //
  // The rule is CAPABILITY-shaped, and the two directions are not symmetric:
  //   FAIL  a row the REFERENCE mounts ACTIVE that ours does not mount active
  //         (absent, or present-but-disabled) — that is a capability every mpd
  //         session loses, which is what this gate exists to catch;
  //   FAIL  a row ours declares that the reference does not declare AT ALL — the
  //         harness stopped shipping it (the `workflow-worker-thread` shape);
  //   NOTE  a row the reference ships `disabled:` and ours does not declare — a
  //         permanently disabled row grants nothing, so demanding it would be
  //         cargo-cult parity (measured: `tool-plugin-manager`, disabled in the
  //         installed `standard` patch);
  //   NOTE  a row the reference ships `disabled:` and ours enables — a deliberate
  //         mpd policy choice that long predates this wave (measured: `tool-ralph`).
  // A row carrying a `!!js` guard counts as ACTIVE: its value is only known at
  // load, and treating an expression as "disabled" would wave through a real gap.
  const reference = shippedPreset(root, REFERENCE_PRESET, yamlLoad)
  let parity = null
  if (reference === null) problems.push(`the installed harness ships no \`${REFERENCE_PRESET}\` preset — cannot check row parity`)
  else if (preset !== null) {
    const refRows = reference.children.filter((row) => idOf(row) !== null)
    const ourRows = preset.children.filter((row) => idOf(row) !== null)
    const refActiveIds = refRows.filter(isActive).map(idOf)
    const ourActiveIds = ourRows.filter(isActive).map(idOf)
    const declaredOurs = new Set(ourRows.map(idOf))
    const declaredRef = new Set(refRows.map(idOf))
    const missing = refActiveIds.filter((id) => !ourActiveIds.includes(id))
    const extra = [...declaredOurs].filter((id) => !declaredRef.has(id))
    const disabledByReference = [...declaredRef].filter((id) => !declaredOurs.has(id) && !refActiveIds.includes(id))
    const enabledHereDisabledThere = ourActiveIds.filter((id) => declaredRef.has(id) && !refActiveIds.includes(id))
    parity = {
      reference: label(reference.file),
      referenceDeclared: declaredRef.size, referenceActive: refActiveIds.length,
      oursDeclared: declaredOurs.size, oursActive: ourActiveIds.length,
      missing, extra, disabledByReference, enabledHereDisabledThere,
    }
    if (missing.length > 0) problems.push(`the ${PRESET_ID} preset does not mount active row(s) the installed ${REFERENCE_PRESET} preset mounts: ${missing.join(", ")}`)
    if (extra.length > 0) problems.push(`the ${PRESET_ID} preset declares row(s) the installed ${REFERENCE_PRESET} preset does not declare at all: ${extra.join(", ")}`)
    if (disabledByReference.length > 0) notes.push(`the installed ${REFERENCE_PRESET} preset declares (disabled) ${disabledByReference.join(", ")} — not required, a disabled row grants no capability either way`)
    if (enabledHereDisabledThere.length > 0) notes.push(`the ${PRESET_ID} preset ENABLES row(s) the installed ${REFERENCE_PRESET} preset ships disabled: ${enabledHereDisabledThere.join(", ")} — deliberate preset policy, listed so a reader can see it`)
  }
  return {
    ok: problems.length === 0, harnessRoot: root, checked, schemaFree, unchecked, problems, notes,
    patchFiles: patchFiles.map(label),
    preset: preset === null ? null : { rowId: preset.row.id ?? null, id: preset.row.config?.id ?? null, children: preset.children.length, file: label(preset.doc.path) },
    persona, parity,
  }
}

/**
 * The raw YAML lines of ONE row (from its `- id:` line to the next sibling),
 * with the indentation it was written at. Used to re-emit a row VERBATIM in
 * another patch (single source of truth, no transcription drift).
 */
function rowBlock(text, rowId) {
  const lines = text.split("\n")
  const pattern = new RegExp("^(\\s*)- id: " + rowId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*$")
  const start = lines.findIndex((line) => pattern.test(line))
  if (start < 0) return null
  const indent = lines[start].match(/^\s*/)[0].length
  let end = start + 1
  while (end < lines.length) {
    const line = lines[end]
    if (line.trim() === "") { end += 1; continue }
    if (line.match(/^\s*/)[0].length <= indent) break
    end += 1
  }
  return { start, end, indent, lines: lines.slice(start, end) }
}

/** The same block re-indented to column 0 (a valid id-target override row). */
function dedentBlock(block) {
  const pad = " ".repeat(block.indent)
  return block.lines.map((line) => (line.startsWith(pad) ? line.slice(block.indent) : line.trim() === "" ? "" : line)).join("\n") + "\n"
}

async function selfTest() {
  const root = harnessRoot()
  if (root === "") fail("self-test: dsh is not on PATH — the case cannot verify the installed harness")
  // Guard against a vacuous pass: this case exists because the persona row's
  // contract changed, so the installed harness must really require `prefix`.
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
  // The manifest's declaration must really drive the audit (no hardcoded path).
  const declared = declaredBundlePatches()
  if (declared.length < 2) fail("self-test: package.json dsh.bundle.patch declares " + declared.length + " patch file(s) — the array model needs the main patch AND the preset patch")
  for (const file of declared) if (!existsSync(file)) fail("self-test: declared bundle patch missing on disk: " + label(file))
  // The repo's own documents must be clean against those schemas.
  const result = await conformance()
  if (result.problems.length > 0) fail("self-test: conformance problems:\n  - " + result.problems.join("\n  - "))
  if (result.unchecked.length > 0) fail("self-test: row(s) could not be checked against the installed harness: " + result.unchecked.join(", "))
  if (result.checked < 20) fail("self-test: only " + result.checked + " harness row(s) checked — the audit lost its surface")
  if (result.preset === null) fail("self-test: the mpd preset row was not found in the declared patch files")
  if (result.preset.children < 25) fail("self-test: the mpd preset exposes only " + result.preset.children + " child rows")
  if (result.parity === null) fail("self-test: row parity could not be computed against the installed shipped `standard` preset")
  // A parity that compares nothing is not a parity.
  if (result.parity.referenceActive < 25) fail("self-test: the installed `standard` preset exposes only " + result.parity.referenceActive + " active rows — the reference is not being read")
  // ── NEGATIVE CONTROLS: the assertions above must be falsifiable ────────────
  // Every arm drives the SAME conformance() the live run uses, over a MUTATED
  // COPY in a temp dir; the live patch's bytes and mtime are asserted unchanged,
  // so another lane's edit can never redden this self-test and this self-test can
  // never touch the live tree (the T-68 hermeticity shape).
  const arms = []
  const arm = (name, ok, detail) => arms.push({ name, ok: Boolean(ok), detail })
  const livePath = join(ROOT, result.preset.file)
  const liveText = readFileSync(livePath, "utf8")
  const liveMtime = statSync(livePath).mtimeMs
  const scratch = mkdtempSync(join(tmpdir(), "mpd-preset-conformance-"))
  try {
    // (i) the retired `text:` persona form must REDDEN
    const personaCopy = join(scratch, "persona-text.patch.yml")
    if (!liveText.includes("prefix: >-")) fail("self-test: the preset's persona row does not use the `prefix:` block scalar — the negative control cannot be seeded")
    writeFileSync(personaCopy, liveText.replace("prefix: >-", "text: >-"))
    const personaRun = await conformance({ patchFiles: [personaCopy], auditFiles: [personaCopy] })
    const personaReddened = personaRun.problems.filter((problem) => /persona/.test(problem))
    arm("(i) retired `text:` persona form -> problems name the persona row", personaReddened.length > 0, personaReddened.join(" | ") || "(no persona problem)")

    // (ii) a REQUIRED row renamed inside the preset must REDDEN the parity check.
    // The arm carries its OWN unmutated copy as the control, so a problem caused
    // by the copy mechanism itself cannot be mistaken for the seeded mutation —
    // and the seam is matched on the ID, never on a message's wording.
    const verbatimCopy = join(scratch, "verbatim.patch.yml")
    writeFileSync(verbatimCopy, liveText)
    const cleanRun = await conformance({ patchFiles: [verbatimCopy], auditFiles: [verbatimCopy] })
    const renamedCopy = join(scratch, "renamed-row.patch.yml")
    writeFileSync(renamedCopy, liveText.replace(/^(\s*)- id: tool-fs$/m, "$1- id: tool-fs-renamed"))
    const renamedRun = await conformance({ patchFiles: [renamedCopy], auditFiles: [renamedCopy] })
    const missingNamed = renamedRun.problems.some((problem) => /\btool-fs\b(?!-)/.test(problem))
    const extraNamed = renamedRun.problems.some((problem) => problem.includes("tool-fs-renamed"))
    arm(
      "(ii) renamed required row -> the unmutated copy is clean and the mutated one names tool-fs AND tool-fs-renamed",
      cleanRun.problems.length === 0 && renamedRun.problems.length > 0 && missingNamed && extraNamed,
      "control problems=" + cleanRun.problems.length + "; mutated: " + (renamedRun.problems.join(" | ") || "(no parity problem)"),
    )

    // (iii) a renamed row also loses its SCHEMA audit, so the arm cannot pass on parity alone
    arm("(iii) the renamed copy really changed the document it audits", liveText !== readFileSync(renamedCopy, "utf8"), "bytes differ")

    // (iv) hermeticity: temp fixtures only; the LIVE patch's bytes + mtime are unchanged
    arm(
      "(iv) hermetic: temp fixtures only; the live preset patch bytes + mtime are unchanged",
      scratch.startsWith(tmpdir()) && readFileSync(livePath, "utf8") === liveText && statSync(livePath).mtimeMs === liveMtime,
      "fixture root " + scratch + " (temp); live mtime " + liveMtime + " -> " + statSync(livePath).mtimeMs,
    )
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
  const failed = arms.filter((a) => !a.ok)
  for (const a of arms) console.log("[preset-conformance self-test] " + (a.ok ? "PASS" : "FAIL") + " - " + a.name + " :: " + String(a.detail).slice(0, 220))
  if (failed.length > 0) fail("self-test: " + failed.length + " negative-control arm(s) did not redden — the assertions above are not falsifiable")
  console.log("[preset-conformance self-test] ok: " + result.checked + " harness rows conform against the installed schemas ("
    + result.schemaFree + " row(s) declare no schema), persona prefix=" + result.persona.hasPrefix
    + ", mpd preset " + result.preset.children + " child rows, row parity " + result.parity.oursActive + "/" + result.parity.referenceActive
    + " (negative controls: " + arms.length + "/" + arms.length + " reddened)")
}

/**
 * @param {string} tag
 * @param {string[]} [extraPatches] extra `--patch` files (the control lane's row override)
 */
function makeSandbox(tag, extraPatches = []) {
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
  for (const patch of extraPatches) patches.push("--patch", patch)
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
  const taken = await new Promise((resolvePort) => {
    const probe = createServer()
    probe.once("error", () => resolvePort(true))
    probe.once("listening", () => probe.close(() => resolvePort(false)))
    probe.listen(port, "127.0.0.1")
  })
  if (taken) fail("port " + port + " is already in use: a previous run's web app is still alive (kill it) or set MPD_QA_PRESET_PORT to a free port")
}

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms))

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
  }).catch((error) => ({ status: 0, text: async () => JSON.stringify({ transport: String(error?.cause?.code ?? error?.message ?? error) }) }))
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
  const steps = {
    conformance: {
      ok: conformanceResult.ok, checked: conformanceResult.checked, schemaFree: conformanceResult.schemaFree,
      patchFiles: conformanceResult.patchFiles, preset: conformanceResult.preset, parity: conformanceResult.parity,
      notes: conformanceResult.notes, problems: conformanceResult.problems,
    },
  }

  // ── positive lane: the shipped preset must mount for a real session ────────
  const sandbox = makeSandbox("main")
  const logPath = join(outDir, "boot.log")
  const web = await boot(sandbox, logPath)
  steps.auth = { ok: web.token !== "" && web.cookie !== "", tokenSeen: web.token !== "", cookieSession: web.cookie !== "" }
  const created = await createSession(web.cookie, PRESET_ID, sandbox.ws)
  const value = created.result?.value ?? null
  steps.sessionCreate = {
    ok: created.result?.ok === true && value?.agentPreset === PRESET_ID,
    status: created.status,
    error: created.result?.ok === false ? created.result.error : undefined,
    sessionId: value?.sessionId ?? null,
    agentPreset: value?.agentPreset ?? null,
    raw: created.raw ?? null,
  }
  // Durable record: the session header names the preset it was composed from.
  //
  // MEASURED (2026-09-27, 0.1.7-rc.2): a hardcoded `session.v3.jsonl.zstd` found
  // NOTHING — the installed harness ships `dsh-session-format-v3-to-v4`, so the
  // canonical generation log is `session.v<version>.jsonl.zstd` and v3 is history.
  // The filename is therefore DISCOVERED from the session directory (canonical
  // `session.v<N>.jsonl[.zstd]`, plus the untagged v0 legacy name), never pinned:
  // a format bump must not turn this assertion into a silent `null`.
  let headerPreset = null
  let headerPath = null
  if (typeof value?.sessionId === "string") {
    const sessionsRoot = join(sandbox.home, "sessions")
    const { zstdDecompressSync } = await import("node:zlib")
    /** The highest committed generation log in one session directory. */
    const generationLog = (sessionDir) => {
      if (!existsSync(sessionDir)) return null
      const candidates = readdirSync(sessionDir)
        .map((name) => ({ name, version: /^session(?:\.v(\d+))?\.jsonl(\.zstd)?$/.exec(name) }))
        .filter((entry) => entry.version !== null)
        .map((entry) => ({ name: entry.name, version: entry.version[1] === undefined ? 0 : Number(entry.version[1]) }))
        .sort((a, b) => a.version - b.version)
      return candidates.length === 0 ? null : join(sessionDir, candidates[candidates.length - 1].name)
    }
    // Durability is throttled, so the header may land a moment after creation.
    for (let attempt = 0; attempt < 15 && headerPreset === null; attempt++) {
      for (const workspace of existsSync(sessionsRoot) ? readdirSync(sessionsRoot) : []) {
        const candidate = generationLog(join(sessionsRoot, workspace, value.sessionId))
        if (candidate === null) continue
        // One `zstdDecompressSync` returns the FIRST frame only — which is exactly
        // the header frame this reads (AGENTS.md §7's concatenated-container trap).
        let text = ""
        try {
          const raw = readFileSync(candidate)
          text = candidate.endsWith(".zstd") ? zstdDecompressSync(raw).toString("utf8") : raw.toString("utf8")
        } catch { continue }
        headerPath = candidate
        const firstLine = text.split("\n").find((line) => line.trim() !== "") ?? ""
        try {
          const header = JSON.parse(firstLine)
          if (typeof header?.agentPreset === "string") headerPreset = header.agentPreset
        } catch {
          headerPreset = /"agentPreset":"([^"]+)"/.exec(text)?.[1] ?? null
        }
        if (headerPreset !== null) break
      }
      if (headerPreset === null) await sleep(1000)
    }
  }
  steps.sessionHeader = { ok: headerPreset === PRESET_ID, agentPreset: headerPreset, log: headerPath }
  const bootLog = web.readLog()
  const signatures = FAILURE_SIGNATURES.filter((needle) => bootLog.includes(needle))
  steps.bootLog = { ok: signatures.length === 0, signatures }
  await stop(web.child)
  // Falsifiable workspace-isolation proof: every session-store key left by this lane
  // must belong to the sandbox workspace, never to the real checkout.
  assertSessionsSandboxed(sandbox.home, sandbox.sandbox, { label: "preset-conformance/main" })

  // ── negative control: the retired `text:` persona form must really fail to mount ───
  // The mpd composition is an inline child list inside the `preset-mpd` ROW now, so
  // the control overrides that row BY ID from a `--patch` file — the same override
  // mechanism the harness documents for profile edits — with the row re-emitted
  // VERBATIM from the shipped patch except for the seeded mutation.
  const presetPatch = join(ROOT, conformanceResult.preset.file)
  const presetText = readFileSync(presetPatch, "utf8")
  const block = rowBlock(presetText, conformanceResult.preset.rowId)
  if (block === null) fail("control: the shipped patch does not declare a row `" + conformanceResult.preset.rowId + "`")
  const controlRow = dedentBlock(block)
  if (!controlRow.includes("prefix: >-")) fail("control: the preset row's persona does not use the `prefix:` block scalar")
  const controlPatch = join(outDir, "control-preset.patch.yml")
  writeFileSync(controlPatch, controlRow.replace("prefix: >-", "text: >-"))
  const controlSandbox = makeSandbox("control", [controlPatch])
  const controlLog = join(outDir, "control-boot.log")
  const controlWeb = await boot(controlSandbox, controlLog)
  const controlCreated = await createSession(controlWeb.cookie, PRESET_ID, controlSandbox.ws)
  const controlError = controlCreated.result?.ok === false ? controlCreated.result.error : null
  const controlMessage = controlError === null ? "" : String(controlError.message ?? "")
  steps.negativeControl = {
    ok: controlError !== null
      && String(controlError.code ?? "").startsWith("agent-preset")
      && (/prefix/.test(controlMessage) || /invalid config/i.test(controlMessage)),
    code: controlError?.code ?? null,
    message: controlError === null ? "the mutated preset mounted — the assertion is not falsifiable" : controlMessage.slice(0, 260),
    mutations: ["preset-mpd row: persona prefix: -> text:"],
    override: "id-target on " + conformanceResult.preset.rowId + " via --patch",
  }
  await stop(controlWeb.child)
  assertSessionsSandboxed(controlSandbox.home, controlSandbox.sandbox, { label: "preset-conformance/control" })

  const allOk = Object.values(steps).every((step) => step.ok)
  // Redact the launch-token URL lines the boot writes into the redirected logs.
  for (const name of ["boot.log", "control-boot.log"]) {
    const path = join(outDir, name)
    if (existsSync(path)) writeFileSync(path, redact(readFileSync(path, "utf8")))
  }
  writeFileSync(join(outDir, "result.json"), JSON.stringify({
    ok: allOk,
    harnessRoot: conformanceResult.harnessRoot,
    note: "session/create mounts the mpd preset row and refuses on any inactive row, so its ok answer is the mount proof; the negative control boots the same sandbox with a --patch id-target rewriting the preset-mpd row's persona back to the retired `text:` form and must fail.",
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
