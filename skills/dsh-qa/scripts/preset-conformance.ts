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
//   cordis.patch.yml   id-targets `agent-preset-registry` -> default: mpd
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
import type { ChildProcess } from "node:child_process"
import { createServer } from "node:net"
import { cpSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { homedir, tmpdir } from "node:os"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { assertSessionsSandboxed, sandboxWorkspace } from "./lib/workspace-isolation.ts"
import { seedSandboxCredentials } from "./lib/credentials.ts"
import { DSH_MISSING, dshAppSpec } from "./lib/dsh-launcher.ts"
import type { Env } from "./lib/dsh-launcher.ts"

/** The checkout root, derived from this script's own URL at `<root>/skills/dsh-qa/scripts/`. */
const ROOT: string = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))
/** The web-app port the lane boots on; `MPD_QA_PRESET_PORT` re-points a run whose port a dead app still holds. */
const PORT: number = Number(process.env.MPD_QA_PRESET_PORT ?? 3198)
/** The root manifest whose `dsh.bundle.patch` declaration drives the whole audit. */
const MANIFEST: string = join(ROOT, "package.json")
// The preset row's plugin specifier: `@deepseek-ai/dsh-agent-preset`. The
// REGISTRY row is `@deepseek-ai/dsh-agent-preset-registry` — a different id that
// a suffix test would confuse, so rows are matched by packageOf(), never by a
// `endsWith` on the specifier.
const PRESET_ROW_PACKAGE: string = "@deepseek-ai/dsh-agent-preset"
/** The installed shipped preset whose row set the mpd preset is compared against for parity. */
const REFERENCE_PRESET: string = "standard"
/** The preset id under audit, and the id every session in the live lane asks for. */
const PRESET_ID: string = "mpd"
/** The QA overlay directory whose files are audited beside the declared bundle patches. */
const OVERLAY_DIR: string = join(ROOT, "tests", "overlays")
/** The specifier prefix that marks a row as harness-owned and therefore schema-audited. */
const HARNESS_ROW_PREFIX: string = "@deepseek-ai/"

/**
 * Report a blocking finding and stop the process with a non-zero exit code.
 * @param message The finding, printed after the case's `FAIL:` prefix.
 * @returns Never: the process exits here, which is what lets a caller rely on `fail` to narrow a checked value.
 */
function fail(message: string): never { console.error("[preset-conformance] FAIL: " + message); process.exit(1) }

/**
 * The bundle patch files, from the ONE declaration the loader itself reads (string OR array).
 * @param root The checkout root that the manifest's relative patch paths resolve against.
 * @param manifestPath The root manifest that declares `dsh.bundle.patch`.
 * @returns The declared patch files as absolute paths; empty when the manifest is unreadable or declares none.
 */
function declaredBundlePatches(root: string = ROOT, manifestPath: string = MANIFEST): string[] {
  // The declared `dsh.bundle.patch` value, still untyped: the manifest may spell it as a string or an array.
  let raw: unknown
  try { raw = JSON.parse(readFileSync(manifestPath, "utf8"))?.dsh?.bundle?.patch } catch { return [] }
  // The declaration normalized to a list, so the single-patch string form still yields one entry.
  const list: unknown[] = Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : []
  return list.filter((value): value is string => typeof value === "string" && value.trim() !== "").map((value) => resolve(root, value))
}

/** Every overlay QA can hand to `dsh --patch`; a stale key here silently drops a capability. */
function overlayFiles(): string[] {
  if (!existsSync(OVERLAY_DIR)) return []
  return readdirSync(OVERLAY_DIR).filter((name) => name.endsWith(".yml")).sort().map((name) => join(OVERLAY_DIR, name))
}

/**
 * Repo-relative label when the file is inside the checkout, else the absolute path.
 * @param file The absolute path to label for a finding or an evidence record.
 * @returns The path relative to the checkout root, or `file` itself when it lies outside it.
 */
function label(file: string): string {
  // The path relative to the checkout root, empty only for the root itself.
  const rel = relative(ROOT, file)
  return rel === "" || rel.startsWith("..") ? file : rel
}

/**
 * Is `dir` the installed harness package (the one that owns node_modules)?
 * @param dir The candidate package directory.
 * @returns True when that directory's `package.json` names `@deepseek-ai/dsh`.
 */
function isHarnessPackage(dir: string): boolean {
  try { return JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).name === "@deepseek-ai/dsh" } catch { return false }
}

/**
 * The PATH-resolved `dsh` launcher — resolved in-process, WITHOUT `sh`.
 *
 * `sh -c "command -v dsh"` is a POSIX-only shape: on Windows the `sh` that answers is Git
 * Bash / MSYS, and it prints a POSIX path (`/c/Users/<user>/AppData/Roaming/npm/dsh`) that
 * `realpathSync` cannot resolve (measured: `ENOENT: lstat 'C:\c'`, which took the whole case
 * down). The PATH scan below is the platform-native equivalent and needs no shell at all.
 * @returns The first PATH entry that holds a `dsh` launcher, or `""` when none does.
 */
function whichDsh(): string {
  // The PATH entries to scan, split on the platform's own separator.
  const dirs: string[] = (process.env.PATH ?? "").split(process.platform === "win32" ? ";" : ":")
  // The launcher names to look for, the win32 `.cmd`/`.exe`/`.bat` shims included.
  const names: readonly string[] = process.platform === "win32" ? ["dsh.cmd", "dsh.exe", "dsh.bat", "dsh"] : ["dsh"]
  for (const dir of dirs) {
    if (dir === "") continue
    for (const name of names) {
      // One PATH entry joined with one candidate launcher name.
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
 * @returns The harness package root, or `""` when no launcher resolves or the walk finds no package.
 */
function harnessRoot(): string {
  // The PATH-resolved launcher path, empty when `dsh` is not installed at all.
  const bin = whichDsh()
  if (bin === "") return ""
  // The launcher's real path, so a symlink chain is followed towards the package that owns it.
  let real = ""
  try { real = realpathSync(bin) } catch { return "" }
  // The directory the upward walk starts from, one level below the launcher file.
  let dir = dirname(real)
  for (let i = 0; i < 8; i++) {
    if (isHarnessPackage(dir)) return dir
    // The npm prefix's own `node_modules/@deepseek-ai/dsh` child, tried beside `dir` itself.
    const nested = join(dir, "node_modules", "@deepseek-ai", "dsh")
    if (isHarnessPackage(nested)) return nested
    // The next directory up; reaching the filesystem root ends the walk.
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return ""
}

/** The loader's own YAML reader: one text in, one parsed value out. */
type YamlLoad = (text: string) => unknown

/**
 * js-yaml resolved from the installed harness (no repo dependency).
 * @param root The installed harness root whose `node_modules` the `js-yaml` build is required from.
 * @returns A reader bound to that build, with the loader's `!!js` tag registered.
 */
function yamlLoader(root: string): YamlLoad {
  // A `require` bound to the harness package, so `js-yaml` resolves from ITS node_modules.
  const req = createRequire(join(root, "package.json"))
  // The harness's own js-yaml build, whose default schema is extended below.
  const yaml = req("js-yaml")
  // The `!!js` scalar tag, reconstructed as a marker object this audit can recognize statically.
  const jsTag = new yaml.Type("tag:yaml.org,2002:js", { kind: "scalar", construct: (data: unknown): { __jsExpr: unknown } => ({ __jsExpr: data }) })
  return (text: string): unknown => yaml.load(text, { schema: yaml.DEFAULT_SCHEMA.extend([jsTag]) })
}

/** The parts of a row's config this audit reads; any further key is reported by the schema check. */
interface RowConfig {
  /** The inline child row list a preset row carries instead of a directory of files. */
  readonly plugins?: unknown
  /** The preset's own id, present on a preset row and compared against the audited id. */
  readonly id?: string
  /** Every other config key, whose presence and names the installed schema decides. */
  readonly [key: string]: unknown
}

/** One plugin row of a composition or patch document, as far as this audit reads it. */
interface PatchRow {
  /** The row's `id`, which names it in findings and is the `--patch` override target. */
  readonly id?: string
  /** The plugin specifier the row mounts; only the harness-owned (`@deepseek-ai/`) ones are audited. */
  readonly name: string
  /** The row's config mapping, absent on a row that takes no config at all. */
  readonly config?: RowConfig
  /** The literal `disabled: true` that makes a row inactive; a `!!js` guard stays active. */
  readonly disabled?: unknown
  /** An `insert:` list, whose entries the loader splices in as sibling rows. */
  readonly insert?: unknown
  /** `group: true` marks a row whose `config` is itself a nested row list. */
  readonly group?: unknown
}

/** The rows of one patch document, split by where the document declared them. */
interface DocumentRows {
  /** The document's own top-level rows. */
  readonly top: PatchRow[]
  /** The child rows declared inside every preset row's inline `config.plugins`. */
  readonly presetChildren: PatchRow[]
  /** Both lists joined — the document's full audit surface. */
  readonly all: PatchRow[]
}

/**
 * Flatten one composition/patch document into its plugin rows (insert lists + groups).
 * @param rows The YAML value to flatten; anything that is not an array contributes no rows.
 * @param out The accumulator a recursive call already collected rows into.
 * @returns Every row of the document, in declaration order.
 */
function flattenRows(rows: unknown, out: PatchRow[] = []): PatchRow[] {
  if (!Array.isArray(rows)) return out
  // The same elements re-typed as opaque YAML nodes: `Array.isArray` widens them to `any`, and
  // every field read below is narrowed at its own use site instead.
  const list: readonly unknown[] = rows
  for (const value of list) {
    if (value === null || typeof value !== "object") continue
    // The node asserted as a row mapping: YAML carries no static shape here, and every field is
    // re-checked at the point it is read, so the assertion only gives the reader a field name.
    const row = value as PatchRow
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
 * @param doc The parsed YAML value of one patch or composition document.
 * @returns The document's own rows, its preset children, and both lists joined.
 */
function documentRows(doc: unknown): DocumentRows {
  // The document's own top-level rows.
  const top = flattenRows(doc)
  // The child rows every preset row declares inline.
  const presetChildren: PatchRow[] = []
  for (const row of top) if (Array.isArray(row.config?.plugins)) presetChildren.push(...flattenRows(row.config?.plugins))
  return { top, presetChildren, all: [...top, ...presetChildren] }
}

/** One parsed patch document, paired with the file it was read from. */
interface PatchDocument {
  /** The absolute path of the patch file, used for the evidence labels. */
  readonly path: string
  /** The parsed YAML value of that file. */
  readonly value: unknown
}

/** The preset row this audit found, with the document that declared it and its inline children. */
interface PresetDeclaration {
  /** The document that declared the row, which every finding about it is labelled with. */
  readonly doc: PatchDocument
  /** The `@deepseek-ai/dsh-agent-preset` row itself. */
  readonly row: PatchRow
  /** The preset's inline child rows, flattened from `config.plugins`. */
  readonly children: PatchRow[]
}

/**
 * The preset declaration of one id among the audited documents, with its inline child rows.
 * @param docs The parsed patch documents to search, in declaration order.
 * @param presetId The `config.id` a row must declare to count as the preset.
 * @returns The owning document, the preset row and its children, or `null` when none declares it.
 */
function findPresetDeclaration(docs: readonly PatchDocument[], presetId: string): PresetDeclaration | null {
  for (const doc of docs) {
    for (const row of flattenRows(doc.value)) {
      if (packageOf(row.name) !== PRESET_ROW_PACKAGE) continue
      if (row.config?.id !== presetId) continue
      return { doc, row, children: flattenRows(row.config?.plugins) }
    }
  }
  return null
}

/** The installed shipped preset of one id, as read from the harness's own patch files. */
interface ShippedPreset {
  /** The absolute path of the patch file that declares it. */
  readonly file: string
  /** The preset row itself. */
  readonly row: PatchRow
  /** The preset's inline child rows. */
  readonly children: PatchRow[]
}

/**
 * The installed shipped preset of a given id, discovered from the harness's own
 * `presets/*.patch.yml` files (0.1.7-rc.2 ships standard/ptc/minimal/cordis under
 * `@deepseek-ai/dsh-web-app`). Returns null when no installed package supplies it.
 * @param root The installed harness root whose `node_modules` is scanned.
 * @param presetId The preset id to find among the shipped patch files.
 * @param yamlLoad The loader's own YAML reader.
 * @returns The declaring file with its row and children, or `null` when nothing ships that preset.
 */
function shippedPreset(root: string, presetId: string, yamlLoad: YamlLoad): ShippedPreset | null {
  // Every `<pkg>/presets/*.patch.yml` the installed harness ships.
  const candidates: string[] = []
  // The installed `@deepseek-ai` scope directory the shipped presets live under.
  const modules = join(root, "node_modules", "@deepseek-ai")
  if (existsSync(modules)) {
    for (const name of readdirSync(modules).sort()) {
      // One package's own preset directory, absent for most packages.
      const dir = join(modules, name, "presets")
      if (!existsSync(dir)) continue
      for (const file of readdirSync(dir).sort()) if (file.endsWith(".patch.yml")) candidates.push(join(dir, file))
    }
  }
  for (const file of candidates) {
    // The parsed document, `null` until the file parses as the loader's YAML dialect.
    let doc: unknown = null
    try { doc = yamlLoad(readFileSync(file, "utf8")) } catch { continue }
    // The preset declaration this file carries, if any.
    const found = findPresetDeclaration([{ value: doc, path: file }], presetId)
    if (found !== null) return { file, row: found.row, children: found.children }
  }
  return null
}

/** One branch of a schemastery schema, whose `dict` holds that branch's allowed top-level keys. */
interface SchemaBranch {
  /** The branch's own key→schema mapping, which is what an allowed-key set is read from. */
  readonly dict?: Record<string, unknown>
}

/** A schemastery `Config` callable, plus the union branches it exposes under `list`. */
interface SchemaFn extends SchemaBranch {
  /** Validates one config object, throwing on a missing required key or a wrong value type. */
  (config: unknown): unknown
  /** The branches of a `.union()` schema; a plain object schema carries none. */
  readonly list?: SchemaBranch[]
}

/**
 * Allowed top-level keys of one schemastery schema, one set per union branch.
 * @param schema The installed plugin's `Config`, or whatever its namespace exported in that slot.
 * @returns One `Set` of allowed keys per union branch; empty when no schema could be read.
 */
function allowedKeySets(schema: SchemaFn | null | undefined): Set<string>[] {
  if (schema === undefined || schema === null || typeof schema !== "function") return []
  // The union branches to inspect; a plain object schema is its own single branch.
  const list: SchemaBranch[] = Array.isArray(schema.list) ? schema.list : [schema]
  // One allowed-key set per branch.
  const sets: Set<string>[] = []
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
 * @param value The parsed YAML node to materialize.
 * @returns The node with every `!!js` marker replaced by the literal `"expression"`.
 */
function materialize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(materialize)
  if (value === null || typeof value !== "object") return value
  // A `!!js` marker object is the only mapping this audit treats specially, so the assertion reads
  // that one key and leaves every other mapping on the ordinary path below.
  if ((value as { __jsExpr?: unknown }).__jsExpr !== undefined) return "expression"
  // The rebuilt mapping, with every nested node materialized the same way.
  const out: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) out[key] = materialize(entry)
  return out
}

/**
 * The installed package that owns a row's specifier.
 * @param specifier The row's `name`, e.g. `@deepseek-ai/dsh-persona`.
 * @returns The bare package name, scope included.
 */
function packageOf(specifier: string): string {
  // The specifier's path segments, whose first two parts are the scope and name.
  const parts = String(specifier).split("/")
  return parts.length >= 2 && specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]
}

/** What the audit knows about one installed package's config schema. */
type SchemaState =
  | { readonly kind: "unresolved" }
  | { readonly kind: "schema-free" }
  | { readonly kind: "schema"; readonly schema: SchemaFn }

/**
 * The installed schema of one row-owned package, resolved through its own entry point.
 * @param root The installed harness root whose `node_modules` is read.
 * @param packageName The bare package name whose `lib/index.ts` exports a schema.
 * @param cache The per-run memo, so one package is imported at most once.
 * @returns Whether that package's schema resolved, and the schema itself when it did.
 */
async function loadSchema(root: string, packageName: string, cache: Map<string, SchemaState>): Promise<SchemaState> {
  // A previously resolved package, answered from the memo without importing it again.
  const cached = cache.get(packageName)
  if (cached !== undefined) return cached
  // "unresolved" (no installed package) is a hole in the audit; "schema-free"
  // (a row whose plugin declares no Config at all) is a legitimate answer.
  let state: SchemaState = { kind: "unresolved" }
  // The package's ESM entry point, the file its `lib/index.ts` conventionally is.
  const entry = join(root, "node_modules", packageName, "lib", "index.js")
  if (existsSync(entry)) {
    state = { kind: "schema-free" }
    try {
      // pathToFileURL: node's ESM loader rejects a bare Windows path
      // (`ERR_UNSUPPORTED_ESM_URL_SCHEME: received protocol 'c:'`); POSIX paths pass either way.
      const mod = await import(pathToFileURL(entry).href)
      // Every shape a plugin package may export its schemastery `Config` under.
      const candidates = [mod.Config, mod.default?.Config]
      for (const value of Object.values(mod)) {
        // One namespace export seen as a possible carrier of its own `Config`.
        const exported = value as { Config?: unknown }
        if (typeof value === "function" && exported.Config !== undefined) candidates.push(exported.Config)
      }
      // The first candidate that really behaves like a schemastery schema.
      const schema = candidates.find((value) => value !== undefined && allowedKeySets(value).length > 0)
      if (schema !== undefined) state = { kind: "schema", schema }
    } catch { state = { kind: "unresolved" } }
  }
  cache.set(packageName, state)
  return state
}

/** One document's audit verdict. */
interface DocumentCheck {
  /** How many of its rows were validated against an installed schema. */
  readonly checked: number
  /** How many of its rows declare no schema at all. */
  readonly schemaFree: number
  /** Its rows whose owning package could not be resolved, so they escaped the audit. */
  readonly unchecked: string[]
  /** Its blocking findings. */
  readonly problems: string[]
}

/**
 * Check one document's harness-owned rows — top-level AND preset children —
 * against the installed schemas.
 * @param root The installed harness root whose `node_modules` is read.
 * @param absPath The patch or overlay file to check.
 * @param yamlLoad The loader's own YAML reader.
 * @param cache The per-run schema memo, shared across every document.
 * @returns The row counts, the rows that could not be checked, and the findings.
 */
async function checkDocument(root: string, absPath: string, yamlLoad: YamlLoad, cache: Map<string, SchemaState>): Promise<DocumentCheck> {
  // Every row the document declares, top-level and preset children alike.
  const { all } = documentRows(yamlLoad(readFileSync(absPath, "utf8")))
  // The blocking findings for this document.
  const problems: string[] = []
  // The rows whose owning package could not be resolved.
  const unchecked: string[] = []
  // How many rows were validated against an installed schema.
  let checked = 0
  // How many rows declare no schema at all.
  let schemaFree = 0
  for (const row of all) {
    if (row.disabled === true) continue
    if (typeof row.name !== "string" || !row.name.startsWith(HARNESS_ROW_PREFIX)) continue
    // The installed package the row's specifier names.
    const packageName = packageOf(row.name)
    // What the audit knows about that package's schema.
    const state = await loadSchema(root, packageName, cache)
    if (state.kind === "unresolved") { unchecked.push(`${row.id ?? row.name} (${packageName})`); continue }
    if (state.kind === "schema-free") { schemaFree += 1; continue }
    // The installed schema this row's config must satisfy.
    const schema = state.schema
    // `!!js` nodes are evaluated by the loader before validation, so they are
    // materialized to a benign string and the STATIC shape is still checked.
    const config = materialize(row.config ?? {})
    checked += 1
    try { schema(config) } catch (error) {
      // Schemastery reports a validation failure by throwing an Error, so this assertion reads the
      // one field the finding prints; only the message's first line names the offending key.
      problems.push(`${row.id ?? row.name} (${row.name}): ${String((error as Error).message).split("\n")[0]}`)
      continue
    }
    // The allowed top-level keys, one set per union branch of the installed schema.
    const sets = allowedKeySets(schema)
    // `materialize` preserves whatever shape it was given and a row config is a YAML mapping, so
    // the keys read here are that mapping's own keys.
    const unknown = Object.keys(config as Record<string, unknown>).filter((key) => !sets.some((set) => set.has(key)))
    if (unknown.length > 0) {
      problems.push(`${row.id ?? row.name} (${row.name}): unknown config key(s) ${unknown.join(", ")} — schemastery keeps them and the row silently loses the setting`)
    }
  }
  return { checked, schemaFree, unchecked, problems }
}

/** A row is ACTIVE unless it carries the literal `disabled: true`. A `!!js` guard stays active. */
const isActive = (row: PatchRow): boolean => row.disabled !== true

/** Rows that declare an `id` (the loader may assign one when a row omits it). */
const idOf = (row: PatchRow): string | null => (typeof row.id === "string" ? row.id : null)

/** The persona-row contract the audit pins on the mpd preset. */
interface PersonaSummary {
  /** The config keys the persona row declares. */
  readonly keys: string[]
  /** Whether the row carries the `prefix` key the installed plugin requires. */
  readonly hasPrefix: boolean
  /** Whether the row still carries the retired `text` key. */
  readonly hasText: boolean
}

/** The audited mpd preset declaration, summarized for the report. */
interface PresetSummary {
  /** The preset row's `id`, or `null` when the row declares none. */
  readonly rowId: string | null
  /** The preset's own `config.id`, or `null`. */
  readonly id: string | null
  /** How many child rows the preset mounts. */
  readonly children: number
  /** Repo-relative label of the patch file that declares it. */
  readonly file: string
}

/** The row-parity comparison between the mpd preset and the installed shipped reference preset. */
interface PresetParity {
  /** Repo-relative label of the reference preset's patch file. */
  readonly reference: string
  /** How many distinct row ids the reference declares. */
  readonly referenceDeclared: number
  /** How many of those the reference mounts active. */
  readonly referenceActive: number
  /** How many distinct row ids the mpd preset declares. */
  readonly oursDeclared: number
  /** How many of those the mpd preset mounts active. */
  readonly oursActive: number
  /** Reference-active row ids the mpd preset does not mount active. */
  readonly missing: readonly (string | null)[]
  /** Row ids the mpd preset declares that the reference does not declare at all. */
  readonly extra: readonly (string | null)[]
  /** Row ids only the reference declares, and only in its disabled form. */
  readonly disabledByReference: readonly (string | null)[]
  /** Row ids the mpd preset enables that the reference ships disabled. */
  readonly enabledHereDisabledThere: readonly (string | null)[]
}

/** The offline audit's verdict over one set of patch and audit files. */
interface ConformanceResult {
  /** Whether no finding was raised at all. */
  readonly ok: boolean
  /** The resolved harness package root the schemas were loaded from. */
  readonly harnessRoot: string
  /** How many harness-owned rows were validated against an installed schema. */
  readonly checked: number
  /** How many harness-owned rows declare no schema at all. */
  readonly schemaFree: number
  /** Rows whose owning package could not be resolved, so they escaped the audit. */
  readonly unchecked: string[]
  /** The blocking findings. */
  readonly problems: string[]
  /** The non-blocking observations worth printing. */
  readonly notes: string[]
  /** Repo-relative labels of the patch files the audit read. */
  readonly patchFiles: string[]
  /** The mpd preset declaration, or `null` when the audit found none. */
  readonly preset: PresetSummary | null
  /** The persona-row contract, or `null` when the persona row was not found. */
  readonly persona: PersonaSummary | null
  /** The row-parity comparison, or `null` when the reference preset was unavailable. */
  readonly parity: PresetParity | null
}

/** The knobs `--self-test` uses to drive seeded mutations through the same code path the live run uses. */
interface ConformanceOptions {
  /** Patch files to audit INSTEAD of the manifest's own declaration. */
  readonly patchFiles?: string[]
  /** Files whose rows are checked; defaults to the patch files plus the QA overlays. */
  readonly auditFiles?: string[]
}

/**
 * The whole offline contract, parameterized so `--self-test` can drive SEEDED
 * mutations through the SAME code path the live run uses.
 * @param opts Patch files to audit instead of the manifest's declaration, and the audit file list.
 * @returns The audit's verdict, its counters and every finding it raised.
 */
async function conformance(opts: ConformanceOptions = {}): Promise<ConformanceResult> {
  // The installed harness root every schema is resolved from, empty when no `dsh` launcher resolves.
  const root = harnessRoot()
  if (root === "") return { ok: false, problems: ["the installed dsh harness could not be resolved (dsh not on PATH)"], unchecked: [], notes: [], harnessRoot: root, checked: 0, schemaFree: 0, patchFiles: [], preset: null, persona: null, parity: null }
  // The loader's own YAML reader, resolved from the installed harness.
  const yamlLoad = yamlLoader(root)
  // The per-run schema memo, so one package is imported at most once.
  const cache = new Map<string, SchemaState>()
  // The bundle patch files to audit, normally the manifest's own declaration.
  const patchFiles = opts.patchFiles ?? declaredBundlePatches()
  // Every file whose rows are checked: the declared patches plus the QA overlays.
  const auditFiles = opts.auditFiles ?? [...patchFiles, ...overlayFiles()]
  // The blocking findings.
  const problems: string[] = []
  // The rows whose owning package could not be resolved.
  const unchecked: string[] = []
  // The non-blocking observations.
  const notes: string[] = []
  // How many rows were validated against an installed schema.
  let checked = 0
  // How many rows declare no schema at all.
  let schemaFree = 0
  // The parsed patch documents the preset and parity checks read.
  const docs: PatchDocument[] = []
  for (const file of patchFiles) {
    if (!existsSync(file)) { problems.push(`${label(file)} :: declared by package.json dsh.bundle.patch but missing from the checkout`); continue }
    // The parsed document, `null` until the file parses as the loader's YAML dialect.
    let value: unknown = null
    // A parse failure is reported with the reader's own first message line, which names the reason.
    try { value = yamlLoad(readFileSync(file, "utf8")) } catch (error) { problems.push(`${label(file)} :: does not parse as the loader's YAML dialect (${String((error as Error).message).split("\n")[0]})`); continue }
    docs.push({ path: file, value })
  }
  for (const file of auditFiles) {
    if (!existsSync(file)) continue
    // One document's verdict: its counters, its findings and the rows it could not check.
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
  // The persona-row contract, `null` until the preset's persona row is read.
  let persona: PersonaSummary | null = null
  if (preset === null) {
    problems.push(`no '@deepseek-ai/dsh-agent-preset' row with config.id: ${PRESET_ID} in ${patchFiles.map(label).join(", ") || "(no patch file)"} — the mpd preset is not declared at all`)
  } else {
    if (preset.children.length < 25) problems.push(`${label(preset.doc.path)} :: the ${PRESET_ID} preset declares only ${preset.children.length} child row(s)`)
    // Persona contract: the positive rule the incident violated.
    // The preset's persona row, absent when the preset stops declaring one.
    const personaRow = preset.children.find((row) => row.id === "persona")
    if (personaRow === undefined) problems.push(`${label(preset.doc.path)} :: the ${PRESET_ID} preset's persona row is missing`)
    else {
      // The persona row's config keys, which decide the positive and negative rules below.
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
  // The installed shipped reference preset the row sets are compared against.
  const reference = shippedPreset(root, REFERENCE_PRESET, yamlLoad)
  // The parity comparison, `null` until the reference preset is available.
  let parity: PresetParity | null = null
  if (reference === null) problems.push(`the installed harness ships no \`${REFERENCE_PRESET}\` preset — cannot check row parity`)
  else if (preset !== null) {
    // The reference preset's rows that carry an id.
    const refRows = reference.children.filter((row) => idOf(row) !== null)
    // The mpd preset's rows that carry an id.
    const ourRows = preset.children.filter((row) => idOf(row) !== null)
    // The row ids the reference mounts active.
    const refActiveIds = refRows.filter(isActive).map(idOf)
    // The row ids the mpd preset mounts active.
    const ourActiveIds = ourRows.filter(isActive).map(idOf)
    // Every row id the mpd preset declares, active or not.
    const declaredOurs = new Set(ourRows.map(idOf))
    // Every row id the reference declares, active or not.
    const declaredRef = new Set(refRows.map(idOf))
    // Reference-active rows the mpd preset does not mount active.
    const missing = refActiveIds.filter((id) => !ourActiveIds.includes(id))
    // Rows the mpd preset declares that the reference does not declare at all.
    const extra = [...declaredOurs].filter((id) => !declaredRef.has(id))
    // Rows only the reference declares, and only in its disabled form.
    const disabledByReference = [...declaredRef].filter((id) => !declaredOurs.has(id) && !refActiveIds.includes(id))
    // Rows the mpd preset enables that the reference ships disabled.
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

/** One row's raw YAML line span, with the indentation it was written at. */
interface RowBlock {
  /** Index of the row's `- id:` line in the source text. */
  readonly start: number
  /** Index one past the row's last line. */
  readonly end: number
  /** The column the row's `- id:` line is indented to. */
  readonly indent: number
  /** The row's own source lines. */
  readonly lines: string[]
}

/**
 * The raw YAML lines of ONE row (from its `- id:` line to the next sibling),
 * with the indentation it was written at. Used to re-emit a row VERBATIM in
 * another patch (single source of truth, no transcription drift).
 * @param text The patch file's full text.
 * @param rowId The `id` of the row to extract.
 * @returns The row's line span, or `null` when no line declares that id.
 */
function rowBlock(text: string, rowId: string): RowBlock | null {
  // The patch file split into lines, indexed by their position.
  const lines = text.split("\n")
  // The exact `- id: <rowId>` line shape, with the id escaped for the regular expression.
  const pattern = new RegExp("^(\\s*)- id: " + rowId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*$")
  // The index of the row's own `- id:` line, `-1` when the row is absent.
  const start = lines.findIndex((line) => pattern.test(line))
  if (start < 0) return null
  // The row's indentation column; `/^\s*/` always matches (the empty string at worst), so the
  // non-null assertion only removes the `null` the matcher's type carries but never returns.
  const indent = lines[start].match(/^\s*/)![0].length
  // The index one past the row's last line.
  let end = start + 1
  while (end < lines.length) {
    // The next line, examined for the end of the row's block.
    const line = lines[end]
    if (line.trim() === "") { end += 1; continue }
    // `/^\s*/` always matches, so this line's indentation length is always readable.
    if (line.match(/^\s*/)![0].length <= indent) break
    end += 1
  }
  return { start, end, indent, lines: lines.slice(start, end) }
}

/**
 * The same block re-indented to column 0 (a valid id-target override row).
 * @param block The row block to re-indent.
 * @returns The row's lines dedented, the last one still newline-terminated.
 */
function dedentBlock(block: RowBlock): string {
  // The exact indentation prefix to strip from every line of the block.
  const pad = " ".repeat(block.indent)
  return block.lines.map((line) => (line.startsWith(pad) ? line.slice(block.indent) : line.trim() === "" ? "" : line)).join("\n") + "\n"
}

/** One falsifiability arm of `--self-test`: a seeded mutation that must redden the audit. */
interface NegativeControlArm {
  /** What the arm proves, printed verbatim in the self-test summary. */
  readonly name: string
  /** Whether the seeded mutation reddened the audit as required. */
  readonly ok: boolean
  /** The arm's own evidence, printed so a reader can see what actually reddened. */
  readonly detail: unknown
}

/**
 * The offline arm: the installed harness must really enforce the persona contract, the repo's own
 * documents must be clean against the installed schemas, and every assertion must be falsifiable.
 * @returns Nothing; the process exits non-zero at the first failure or non-reddening control arm.
 */
async function selfTest(): Promise<void> {
  // The installed harness root whose schemas the audit is validated against.
  const root = harnessRoot()
  if (root === "") fail("self-test: dsh is not on PATH — the case cannot verify the installed harness")
  // Guard against a vacuous pass: this case exists because the persona row's
  // contract changed, so the installed harness must really require `prefix`.
  // What the audit knows about the installed persona plugin's schema.
  const personaState = await loadSchema(root, "@deepseek-ai/dsh-persona", new Map<string, SchemaState>())
  if (personaState.kind !== "schema") fail("self-test: the installed @deepseek-ai/dsh-persona exposes no config schema (" + personaState.kind + ")")
  // The installed persona schema, which must require `prefix` and refuse `text`.
  const persona = personaState.schema
  // The allowed-key sets of that schema, one per union branch.
  const keySets = allowedKeySets(persona)
  // Every key the installed persona schema accepts, across all of its branches.
  const keys = [...new Set(keySets.flatMap((set) => [...set]))]
  if (!keys.includes("prefix")) fail("self-test: the installed dsh-persona schema has no `prefix` key: " + keys.join(","))
  if (keys.includes("text")) fail("self-test: the installed dsh-persona still accepts `text` — revisit the preset row form")
  // Whether the installed schema actually refuses a text-only config.
  let invalid = false
  try { persona({ text: "x" }) } catch { invalid = true }
  if (!invalid) fail("self-test: the installed dsh-persona accepted a text-only config — the mount failure this case pins cannot happen")
  // The manifest's declaration must really drive the audit (no hardcoded path).
  // The patch files the manifest declares.
  const declared = declaredBundlePatches()
  if (declared.length < 2) fail("self-test: package.json dsh.bundle.patch declares " + declared.length + " patch file(s) — the array model needs the main patch AND the preset patch")
  for (const file of declared) if (!existsSync(file)) fail("self-test: declared bundle patch missing on disk: " + label(file))
  // The repo's own documents must be clean against those schemas.
  // The live audit's verdict, from the same call the real run makes.
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
  // The negative-control arms collected so far.
  const arms: NegativeControlArm[] = []
  // Records one arm's outcome for the summary printed at the end.
  const arm = (name: string, ok: unknown, detail: unknown): void => { arms.push({ name, ok: Boolean(ok), detail }) }
  // The live preset patch the arms copy and mutate.
  const livePath = join(ROOT, result.preset.file)
  // Its bytes, which the hermeticity arm asserts are unchanged.
  const liveText = readFileSync(livePath, "utf8")
  // Its modification time, which the hermeticity arm asserts is unchanged.
  const liveMtime = statSync(livePath).mtimeMs
  // The temp fixture root every mutated copy is written into.
  const scratch = mkdtempSync(join(tmpdir(), "mpd-preset-conformance-"))
  try {
    // (i) the retired `text:` persona form must REDDEN
    // The mutated copy that carries the retired `text:` persona form.
    const personaCopy = join(scratch, "persona-text.patch.yml")
    if (!liveText.includes("prefix: >-")) fail("self-test: the preset's persona row does not use the `prefix:` block scalar — the negative control cannot be seeded")
    writeFileSync(personaCopy, liveText.replace("prefix: >-", "text: >-"))
    // The verdict over the mutated persona copy.
    const personaRun = await conformance({ patchFiles: [personaCopy], auditFiles: [personaCopy] })
    // The findings that name the persona row, which is what the arm requires of them.
    const personaReddened = personaRun.problems.filter((problem) => /persona/.test(problem))
    arm("(i) retired `text:` persona form -> problems name the persona row", personaReddened.length > 0, personaReddened.join(" | ") || "(no persona problem)")

    // (ii) a REQUIRED row renamed inside the preset must REDDEN the parity check.
    // The arm carries its OWN unmutated copy as the control, so a problem caused
    // by the copy mechanism itself cannot be mistaken for the seeded mutation —
    // and the seam is matched on the ID, never on a message's wording.
    // The unmutated copy, which is the arm's own control.
    const verbatimCopy = join(scratch, "verbatim.patch.yml")
    writeFileSync(verbatimCopy, liveText)
    // The verdict over the unmutated copy: any finding here would be a copy-mechanism artefact.
    const cleanRun = await conformance({ patchFiles: [verbatimCopy], auditFiles: [verbatimCopy] })
    // The copy with the `tool-fs` row id renamed.
    const renamedCopy = join(scratch, "renamed-row.patch.yml")
    writeFileSync(renamedCopy, liveText.replace(/^(\s*)- id: tool-fs$/m, "$1- id: tool-fs-renamed"))
    // The verdict over the renamed copy, which must name both rows.
    const renamedRun = await conformance({ patchFiles: [renamedCopy], auditFiles: [renamedCopy] })
    // Whether a finding names the row that went missing.
    const missingNamed = renamedRun.problems.some((problem) => /\btool-fs\b(?!-)/.test(problem))
    // Whether a finding names the row that appeared in its place.
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
  // The arms that did not redden, which is what the final assertion reports.
  const failed = arms.filter((a) => !a.ok)
  for (const a of arms) console.log("[preset-conformance self-test] " + (a.ok ? "PASS" : "FAIL") + " - " + a.name + " :: " + String(a.detail).slice(0, 220))
  if (failed.length > 0) fail("self-test: " + failed.length + " negative-control arm(s) did not redden — the assertions above are not falsifiable")
  // An empty `problems` list (asserted above) is exactly the case where the persona row was found
  // and its keys read, so the contract summary below always has one to print.
  console.log("[preset-conformance self-test] ok: " + result.checked + " harness rows conform against the installed schemas ("
    + result.schemaFree + " row(s) declare no schema), persona prefix=" + result.persona!.hasPrefix
    + ", mpd preset " + result.preset.children + " child rows, row parity " + result.parity.oursActive + "/" + result.parity.referenceActive
    + " (negative controls: " + arms.length + "/" + arms.length + " reddened)")
}

/** One isolated sandbox: the DSH_HOME, HOME, profile and workspace a boot runs inside. */
interface Sandbox {
  /** The temp sandbox root everything else lives under. */
  readonly sandbox: string
  /** The sandbox `DSH_HOME` holding the profile, the session store and the seeded credentials. */
  readonly home: string
  /** The sandbox `HOME`, which keeps skill roots and the harness home out of the real one. */
  readonly userHome: string
  /** The profile directory the web app boots from. */
  readonly profile: string
  /** The sandbox workspace every session in this sandbox is created in. */
  readonly ws: string
  /** The launcher-level `--patch` arguments, flattened as `["--patch", file]` pairs. */
  readonly patches: string[]
  /** The child-process environment a boot in this sandbox runs with. */
  readonly env: Env
}

/**
 * Create one isolated sandbox whose profile links back to this checkout.
 * @param tag A short label that names the temp directory the sandbox is created under.
 * @param extraPatches Launcher-level `--patch` files this sandbox boots with.
 * @returns The sandbox paths, its flattened `--patch` arguments and its child environment.
 */
function makeSandbox(tag: string, extraPatches: string[] = []): Sandbox {
  // The temp sandbox root, created fresh so no run can inherit another run's state.
  const sandbox = mkdtempSync(join(tmpdir(), "mpd-preset-" + tag + "-"))
  // The sandbox `DSH_HOME` the profile and the session store live under.
  const home = join(sandbox, "home")
  // The sandbox `HOME`, kept apart from `home` so skill roots cannot leak in from the real one.
  const userHome = join(sandbox, "userhome")
  // The profile directory the web app boots from.
  const profile = join(home, "profiles", "w")
  mkdirSync(join(profile, "node_modules", "@mpd-dsh"), { recursive: true })
  mkdirSync(userHome, { recursive: true })
  // The REAL credential store, copied once into the sandbox so the boot can authenticate.
  const creds = join(homedir(), ".dsh", ".credentials.yaml")
  seedSandboxCredentials(home, { credentialsFile: creds })
  // The REAL settings file, copied when present because gateway routes configure the chain there.
  const settings = join(homedir(), ".dsh", "settings.yaml")
  if (existsSync(settings)) cpSync(settings, join(home, "settings.yaml"))
  // A checkout install IS a link: node_modules/@mpd-dsh/mpd -> the repo, which is
  // what `dsh plugin add <repo>` writes and what the bundle exports resolve through.
  symlinkSync(ROOT, join(profile, "node_modules", "@mpd-dsh", "mpd"), "junction")
  writeFileSync(join(profile, "package.json"), JSON.stringify({
    name: "dsh-profile-w", private: true, dependencies: {}, dsh: { profile: { bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "@mpd-dsh/mpd"] } },
  }, null, 2))
  // The launcher arguments that hand each extra patch file to the session.
  const patches: string[] = []
  for (const patch of extraPatches) patches.push("--patch", patch)
  if (join(home).startsWith(join(homedir(), ".dsh"))) fail("isolation assertion: DSH_HOME points at the real home")
  // Workspace isolation: sessions must be created inside a sandbox workspace, never
  // with the real checkout as their cwd (DSH_HOME/HOME do not cover workspace state).
  // The workspace every session in this sandbox must be created in.
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
 * @param port The port the lane is about to boot on.
 * @returns Nothing; the process exits when something already answers on that port.
 */
async function assertPortFree(port: number): Promise<void> {
  // Whether anything already answers on the port, which would break the boot inside the loader.
  const taken = await new Promise<boolean>((resolvePort: (value: boolean) => void) => {
    // A throwaway listener used only to probe the port's availability.
    const probe = createServer()
    probe.once("error", () => resolvePort(true))
    probe.once("listening", () => probe.close(() => resolvePort(false)))
    probe.listen(port, "127.0.0.1")
  })
  if (taken) fail("port " + port + " is already in use: a previous run's web app is still alive (kill it) or set MPD_QA_PRESET_PORT to a free port")
}

// A delay that lets a boot loop pace its polls, in milliseconds.
const sleep = (ms: number): Promise<void> => new Promise<void>((resolveSleep) => setTimeout(resolveSleep, ms))

/**
 * Redact the process launch token the Web app prints in its URL line. Evidence
 * logs are committed (AGENTS.md §10), and although the token belongs to an
 * already-disposed sandbox process, no credential-shaped string belongs in a
 * committed artifact.
 * @param text The log text to redact.
 * @returns The text with every launch token replaced by its placeholder.
 */
function redact(text: string): string {
  return text.replace(/token=[A-Za-z0-9_-]+/g, "token=<redacted>")
}

/** Every web app this lane booted, so the CLI can never leave one holding its port. */
const BOOTED: ChildProcess[] = []

/** A booted sandbox web app: its child handle, its log reader and its auth material. */
interface BootHandle {
  /** The spawned app process, which `stop` kills. */
  readonly child: ChildProcess
  /** Re-reads the redirected boot log; a file with nothing in it yet reads as empty. */
  readonly readLog: () => string
  /** The launch token parsed from the URL line, empty until the app prints it. */
  readonly token: string
  /** The session cookie harvested from the authorized root request, empty until it works. */
  readonly cookie: string
}

/**
 * Boot one sandbox and return its log path, token/cookie and the child handle.
 * @param sandbox The isolated sandbox to boot in.
 * @param logPath The file both output streams are redirected to.
 * @returns The child handle, a log reader, and the token and cookie the gateway answered with.
 */
async function boot(sandbox: Sandbox, logPath: string): Promise<BootHandle> {
  // The log file's descriptor, handed to BOTH streams so the child never writes into a pipe.
  const fd = openSync(logPath, "w")
  // Launcher flags (`--patch`) come BEFORE the profile app's own flags: the
  // launcher hands everything after its first unrecognized argument to the app.
  // The launcher is spawned by its RESOLVED path: a bare `dsh` is not portable (npm installs a
  // `.cmd` shim on win32 and node refuses that without a shell - measured 2026-09-22: the whole
  // lane died with `spawn dsh ENOENT` before this).
  const spec = dshAppSpec(["--profile", "w", ...sandbox.patches, "--port", String(PORT), "--no-open"], sandbox.env)
  if (spec === null) fail(DSH_MISSING)
  // The booted web app, held in BOOTED so the CLI can always kill it.
  const child = spawn(spec.command, spec.args, {
    env: sandbox.env, cwd: sandbox.ws, stdio: ["ignore", fd, fd],
  })
  BOOTED.push(child)
  // Re-reads the boot log, so the token loop can watch for the URL line.
  const readLog = (): string => { try { return readFileSync(logPath, "utf8") } catch { return "" } }
  // The launch token parsed from the URL line, empty until the app prints it.
  let token = ""
  // The session cookie harvested from the authorized root request, empty until it works.
  let cookie = ""
  // The instant the boot is given up on, so a silent app cannot hang the lane.
  const deadline = Date.now() + 90000
  while (Date.now() < deadline) {
    await sleep(1500)
    // The launch-token match in the log's current content.
    const match = /token=([A-Za-z0-9_-]+)/.exec(readLog())
    if (match !== null) token = match[1]
    if (token === "") continue
    try {
      // The authorized root request, which is what mints the session cookie.
      const authorize = await fetch(`http://127.0.0.1:${PORT}/?token=${token}`, { redirect: "manual", signal: AbortSignal.timeout(8000) })
      cookie = (authorize.headers.getSetCookie?.() ?? []).map((value) => value.split(";")[0]).join("; ") || cookie
      // The root request made WITH that cookie, which proves the session is usable.
      const root = await fetch(`http://127.0.0.1:${PORT}/`, { headers: cookie === "" ? {} : { cookie }, signal: AbortSignal.timeout(8000) })
      if (cookie !== "" && root.status === 200) break
    } catch { /* not serving yet */ }
  }
  return { child, readLog, token, cookie }
}

/** The created session's fields, as far as this case reads them back. */
interface CreatedSession {
  /** The harness's own id for the created session, which keys its store directory. */
  readonly sessionId?: unknown
  /** The preset the session was composed from, which is the mount proof itself. */
  readonly agentPreset?: unknown
}

/** The harness's own refusal of a `session/create` call. */
interface SessionCreateError {
  /** The machine-readable failure code, e.g. `agent-preset/invalid`. */
  readonly code?: unknown
  /** The human-readable refusal, whose first line names the offending row. */
  readonly message?: unknown
}

/** The `result` half of a `session/create` envelope: a success and a refusal are disjoint shapes. */
type SessionCreateResult =
  | { readonly ok: true; readonly value: CreatedSession; readonly error?: undefined }
  | { readonly ok: false; readonly value?: undefined; readonly error: SessionCreateError }

/** The JSON-RPC envelope one gateway call answers with. */
interface SessionEnvelope {
  /** The call's result, absent when the request never reached the method. */
  readonly result?: SessionCreateResult
  /** The transport-level failure the lane reported instead of a body. */
  readonly transport?: unknown
}

/** What one `session/create` call produced. */
interface SessionCreation {
  /** The HTTP status, or `0` when the request never reached the server. */
  readonly status: number
  /** The decoded JSON-RPC result, or `null` when the body was not an envelope. */
  readonly result: SessionCreateResult | null
  /** The transport-level failure, when the lane reported one instead of a body. */
  readonly transport: unknown
  /** The body's first 400 characters, kept for the evidence record whatever its shape. */
  readonly raw: string
}

/**
 * Create one session through the gateway's own RPC envelope, inside the sandbox workspace.
 * @param cookie The session cookie the boot harvested; empty means the call is unauthenticated.
 * @param presetId The preset the session must be composed from.
 * @param cwd The workspace the session runs in, never the real checkout.
 * @returns The HTTP status, the decoded result and the body prefix.
 */
async function createSession(cookie: string, presetId: string, cwd: string): Promise<SessionCreation> {
  // A unique JSON-RPC id, so the reply can be matched to this call.
  const rpcId = "preset-conformance-" + String(Date.now())
  // The gateway's reply; a transport failure is folded into a synthetic `{status: 0}` answer.
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
  // The decoded reply envelope, `null` when the body was not JSON at all.
  let envelope: SessionEnvelope | null = null
  try { envelope = JSON.parse(raw) } catch { envelope = null }
  return { status: response.status, result: envelope?.result ?? null, transport: envelope?.transport ?? null, raw: raw.slice(0, 400) }
}

/**
 * Stop one booted web app, escalating from SIGTERM to SIGKILL and then to a tree kill on win32.
 * @param child The child handle `boot` returned.
 * @returns Nothing; every failure mode is swallowed because the caller is already on its way out.
 */
async function stop(child: ChildProcess): Promise<void> {
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
const FAILURE_SIGNATURES: readonly string[] = ["invalid config", "failed to apply loader entry", "agent-preset/invalid", "did not activate"]

/** One named arm of the live run: its verdict plus that arm's own evidence fields. */
interface RunStep {
  /** Whether this arm passed; the remaining fields are the arm's own evidence. */
  ok: boolean
  /** Every further field the arm records, serialized verbatim into `result.json`. */
  [field: string]: unknown
}

/**
 * The live arm: an isolated sandbox boots the web profile, a real session mounts the mpd preset,
 * and a negative control proves the mount assertion is falsifiable.
 * @returns Nothing; a failing arm sets a non-zero exit code and every booted child is killed.
 */
async function runReal(): Promise<void> {
  await assertPortFree(PORT)
  // The evidence directory stamp, in the filename-safe ISO form the QA tree uses.
  const ts = new Date().toISOString().replaceAll(":", "-")
  // The evidence directory this run writes into.
  const outDir = join(ROOT, "evidence", "dsh-qa", "preset-conformance", ts)
  mkdirSync(outDir, { recursive: true })
  // The offline verdict, recorded beside the live arms.
  const conformanceResult = await conformance()
  // Every named arm of the run, keyed by step name.
  const steps: Record<string, RunStep> = {
    conformance: {
      ok: conformanceResult.ok, checked: conformanceResult.checked, schemaFree: conformanceResult.schemaFree,
      patchFiles: conformanceResult.patchFiles, preset: conformanceResult.preset, parity: conformanceResult.parity,
      notes: conformanceResult.notes, problems: conformanceResult.problems,
    },
  }

  // ── positive lane: the shipped preset must mount for a real session ────────
  // The sandbox the positive lane boots in.
  const sandbox = makeSandbox("main")
  // The positive lane's boot log.
  const logPath = join(outDir, "boot.log")
  // The booted web app.
  const web = await boot(sandbox, logPath)
  steps.auth = { ok: web.token !== "" && web.cookie !== "", tokenSeen: web.token !== "", cookieSession: web.cookie !== "" }
  // The `session/create` reply, whose `ok` is the mount proof.
  const created = await createSession(web.cookie, PRESET_ID, sandbox.ws)
  // The created session's fields, `null` when the call did not succeed.
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
  // The preset the session header names, which is the durable half of the mount proof.
  let headerPreset: string | null = null
  // The generation log the header was read from, for the evidence record.
  let headerPath: string | null = null
  if (typeof value?.sessionId === "string") {
    // The sandbox's session store, whose children are keyed by workspace.
    const sessionsRoot = join(sandbox.home, "sessions")
    // The decompressor for the `.zstd`-framed generation logs.
    const { zstdDecompressSync } = await import("node:zlib")
    /**
     * The highest committed generation log in one session directory.
     * @param sessionDir The session's own store directory.
     * @returns The newest generation log's path, or `null` when none exists yet.
     */
    const generationLog = (sessionDir: string): string | null => {
      if (!existsSync(sessionDir)) return null
      // Every generation log in the directory, with the version its name carries.
      const candidates = readdirSync(sessionDir)
        .map((name) => ({ name, version: /^session(?:\.v(\d+))?\.jsonl(\.zstd)?$/.exec(name) }))
        .filter((entry): entry is { name: string; version: RegExpExecArray } => entry.version !== null)
        .map((entry) => ({ name: entry.name, version: entry.version[1] === undefined ? 0 : Number(entry.version[1]) }))
        .sort((a, b) => a.version - b.version)
      return candidates.length === 0 ? null : join(sessionDir, candidates[candidates.length - 1].name)
    }
    // Durability is throttled, so the header may land a moment after creation.
    for (let attempt = 0; attempt < 15 && headerPreset === null; attempt++) {
      for (const workspace of existsSync(sessionsRoot) ? readdirSync(sessionsRoot) : []) {
        // The newest generation log of this session, or `null` before the first write lands.
        const candidate = generationLog(join(sessionsRoot, workspace, value.sessionId))
        if (candidate === null) continue
        // One `zstdDecompressSync` returns the FIRST frame only — which is exactly
        // the header frame this reads (AGENTS.md §7's concatenated-container trap).
        // The decoded log text, empty while the file cannot be read yet.
        let text = ""
        try {
          // The log's raw bytes, decompressed when the file carries the `.zstd` frame.
          const raw = readFileSync(candidate)
          text = candidate.endsWith(".zstd") ? zstdDecompressSync(raw).toString("utf8") : raw.toString("utf8")
        } catch { continue }
        headerPath = candidate
        // The log's first non-blank line, which is the session header frame.
        const firstLine = text.split("\n").find((line) => line.trim() !== "") ?? ""
        try {
          // The header frame, parsed as the session record it is.
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
  // The positive lane's full boot log.
  const bootLog = web.readLog()
  // The mount-failure signatures the boot really printed.
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
  // The preset the control addresses; a preset the audit did not find already failed
  // `steps.conformance.ok`, so the assertions below only remove the audit's `null` and leave the
  // control's own lookups unchanged. The row-id assertion is the same contract one level down: the
  // loader always writes an `id` on `preset-mpd`, and a row without one fails the same lookup.
  const presetPatch = join(ROOT, conformanceResult.preset!.file)
  // Its full text, from which the row is taken verbatim.
  const presetText = readFileSync(presetPatch, "utf8")
  // The preset row's own line span, or `null` when that patch stops declaring the row.
  const block = rowBlock(presetText, conformanceResult.preset!.rowId!)
  if (block === null) fail("control: the shipped patch does not declare a row `" + conformanceResult.preset!.rowId + "`")
  // The row re-indented to column 0, which is what a `--patch` override row must look like.
  const controlRow = dedentBlock(block)
  if (!controlRow.includes("prefix: >-")) fail("control: the preset row's persona does not use the `prefix:` block scalar")
  // The override patch the control sandbox boots with.
  const controlPatch = join(outDir, "control-preset.patch.yml")
  writeFileSync(controlPatch, controlRow.replace("prefix: >-", "text: >-"))
  // The sandbox the negative control boots in, with the override patch applied.
  const controlSandbox = makeSandbox("control", [controlPatch])
  // The control lane's boot log.
  const controlLog = join(outDir, "control-boot.log")
  // The control lane's booted web app.
  const controlWeb = await boot(controlSandbox, controlLog)
  // The control's `session/create` reply, which MUST report a refusal.
  const controlCreated = await createSession(controlWeb.cookie, PRESET_ID, controlSandbox.ws)
  // The harness's refusal, or `null` when the mutated preset mounted.
  const controlError = controlCreated.result?.ok === false ? controlCreated.result.error : null
  // The refusal's message, empty when the mutated preset mounted.
  const controlMessage = controlError === null ? "" : String(controlError.message ?? "")
  steps.negativeControl = {
    ok: controlError !== null
      && String(controlError.code ?? "").startsWith("agent-preset")
      && (/prefix/.test(controlMessage) || /invalid config/i.test(controlMessage)),
    code: controlError?.code ?? null,
    message: controlError === null ? "the mutated preset mounted — the assertion is not falsifiable" : controlMessage.slice(0, 260),
    mutations: ["preset-mpd row: persona prefix: -> text:"],
    override: "id-target on " + conformanceResult.preset!.rowId + " via --patch",
  }
  await stop(controlWeb.child)
  assertSessionsSandboxed(controlSandbox.home, controlSandbox.sandbox, { label: "preset-conformance/control" })

  // Whether every named arm passed.
  const allOk = Object.values(steps).every((step) => step.ok)
  // Redact the launch-token URL lines the boot writes into the redirected logs.
  for (const name of ["boot.log", "control-boot.log"]) {
    // The log file to redact, absent when a lane never reached its boot.
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

// The command-line arguments, which decide between the offline self-test and the live lane.
const argv = process.argv.slice(2)
if (argv.includes("--self-test")) await selfTest()
else {
  // A live lane must never leave its web app behind: the child holds the port, and the NEXT boot in
  // the same run (the negative control) then dies with EADDRINUSE - measured 2026-09-22, after a step
  // threw and no `stop()` was ever reached. Whatever happens, the booted children die here.
  try {
    await runReal()
  } catch (error) {
    // A thrown value carries a `stack` on every lane path, so this assertion only makes the one
    // field the failure line prints readable under an `unknown` catch variable.
    console.error("[preset-conformance] FAIL: " + String((error as { stack?: unknown })?.stack ?? error).slice(0, 2000))
    process.exitCode = 1
  } finally {
    for (const child of BOOTED) {
      try { child.kill("SIGKILL") } catch { /* already gone */ }
    }
  }
}
