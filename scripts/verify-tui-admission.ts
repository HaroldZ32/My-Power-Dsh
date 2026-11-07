#!/usr/bin/env node
// verify-tui-admission — the dsh-TUI ecosystem's admission requirements as a HARD gate (user clause 6).
//
// WHY THIS FILE EXISTS: `docs/tui-admission.md` is a self-assessment. A self-assessment is a statement,
// not a requirement: the wave that produced it measured the bundle against the dsh-TUI admission
// rulebook ONCE and wrote the result down, and nothing stopped the tree from drifting away from it
// afterwards. This gate turns the mechanically checkable part of that page into failures, and it runs
// the installed host's OWN admission chain against BOTH shipped manifests, so a manifest the host
// would refuse cannot land behind a green page.
//
// TWO ARMS, AND THEY ARE DIFFERENT (the static arm carries a COMPAT lane of its own):
//
//   STATIC (host-free) — the rules this repository can decide from its own bytes, derived from
//   `docs/tui-admission.md` §4 (the A–G checklist) and §5 (the R1–R7 red lines) plus the guide copy at
//   `evidence/dshgo/tui-admission/2026-11-03T01-23-16Z/admission-guide.md`: the manifest `$schema` is an
//   absolute URI and its version token agrees with `manifestVersion` 0.15; the `id` is stable and
//   identical across the two manifests; `facets.host` names an entry and an `apiVersion`, and the entry
//   resolves from the manifest's own directory; no `client`/`worker` facet appears; the licence and the
//   source repository are locatable; every optional contract carries a written fallback and neither
//   `provides` nor `requires.services` appears; `permissions`/`subscriptions`/`contributes.commands`
//   are declared as arrays and no permission is declared without a use in the TUI source; no credential
//   reference and no `console.log` on the TUI plane; `subscriptions` stays empty (R1's PASS rests on
//   it); the three `.mpd` user-data roots recorded by the R5 deviation are still written.
//
//   HOST (host-bound) — the installed `@deepseek-harness-tui/dsh-tui`'s own chain against both
//   manifests: `loadSpecData` -> the registry profile self-checks -> `createContractIndex` ->
//   `parseManifest` -> `validatePlugin` -> `projectManifest` -> `negotiate`, against the host's own
//   `buildLegacyHostDescriptor` built from the host's own `HOST_SUPPORTED_CONTRACTS`. The manifest BYTES
//   go through the host's OWN `parseManifest`, never a `JSON.parse` substitute: the previous wave
//   recorded that a `JSON.parse` probe proves less than it claims, and this gate must not repeat it.
//   The host's `package.json#exports` has no `./lib/*` subpath, so the modules are reached by absolute
//   file URL exactly as the installed payload lays them out.
//
//   COMPAT (R6, host-free where it can be) — `compat.hosts` is a PUBLICATION CLAIM, so the gate itself
//   asserts it instead of trusting the field. In BOTH the normal and `--static-only` runs: every manifest
//   declares a NON-EMPTY band of `@scope/name@x.y.z` coordinates; the two manifests declare the SAME band
//   (a drift guard in the gate, not only in a unit test); and the `host-tui` component ref in
//   `dsh-distribution.json` is INSIDE the band. When a host IS discovered, its exact version is inside the
//   band too; when discovery finds none, that sub-assertion prints as NOT CHECKED (`BOUND`) instead of
//   passing silently. `--self-test` carries a negative control for EACH of the four.
//
// NO HOST IS NOT A PASS (decision D5): when no installed host resolves, the gate prints every discovery
// candidate it tried and the exact remedy, and exits non-zero. `--static-only` exits 3 for the same
// reason — a skip is never rendered as a pass, and no run of this script without the host arm is an
// admission verdict.
//
// THE R5 DEVIATION IS A NAMED ALLOWANCE, NEVER A SILENT PASS: `~/.mpd/workmate`, `~/.mpd/memory` and
// `~/.mpd/codegraph` sit outside `~/.dsh-tui` by recorded user decision (docs §5.1). The gate prints
// that as `ALLOWED-DEVIATION` with its reason, never as PASS, and it RE-CHECKS the record: if one of
// the three roots stops being written, or a write under `~/.dsh-tui` appears, the gate fails and the
// page must move in the same change.
//
// HONEST BOUNDS: this is a STATIC admission check plus the host's own negotiation. It is not a live TTY
// mount, it does not run the host's `/plugin check` (that is `skills/dsh-qa/scripts/tui-admission.ts`),
// and it carries no artifact digest, so nothing it prints is a "Verified" claim. The descriptor the host
// arm negotiates against is the host's legacy-compatibility descriptor, not live probe evidence.
//
// Modes:
//   node scripts/verify-tui-admission.ts                  the gate: static arms + the host arm
//   node scripts/verify-tui-admission.ts --self-test      host-free fixture arms + a NEGATIVE control
//   node scripts/verify-tui-admission.ts --manifest <p>   fixture mode: static arms on that file only
//   node scripts/verify-tui-admission.ts --static-only    static arms only; exits 3 (never a pass)
//   node scripts/verify-tui-admission.ts --host-dir <dir> restrict host discovery to one candidate
//   node scripts/verify-tui-admission.ts --json <path>    also write the full arm record
//   node scripts/verify-tui-admission.ts --help
//
// Exit codes: 0 every arm passed · 1 at least one finding · 2 usage/config error · 3 the host arm was
// not run (a skip is never a pass).
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import type { Dirent } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { delimiter, dirname, join, relative, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

/** The line prefix every byte this gate writes carries, so a transcript stays greppable. */
const TAG: string = "[tui-admission]"
/** This script's own path, spawned by the self-test as the child under test. */
const SELF: string = fileURLToPath(import.meta.url)
/** The repository root, resolved from this file's own location under `<root>/scripts/`. */
const REPO: string = dirname(dirname(SELF))
/** The runner's exit-code contract: 0 green, 1 findings, 2 usage/config, 3 host arm not run. */
const EXIT = { GREEN: 0, FINDINGS: 1, CONFIG: 2, NOT_PASSED: 3 } as const
/** The one Community manifest version the v0.15 admission profile accepts. */
const MANIFEST_VERSION: string = "0.15"
/** The two shipped manifests, in report order: the bundle-level file and the package-level one. */
const DEFAULT_MANIFESTS: readonly string[] = ["dsh-plugin.json", "packages/mpd-tui-plugin/dsh-plugin.json"]
/** The two TUI packages whose source IS the TUI plane for the R2/R3 rules. */
const TUI_SOURCE_DIRS: readonly string[] = ["packages/mpd-tui-plugin/src", "packages/mpd-tui-adapter-plugin/src"]
/** An absolute URI: a scheme followed by `://` and a non-empty body. */
const ABSOLUTE_URI: RegExp = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/\S+$/
/** The manifest schema URI's own version token, e.g. `dsh-plugin-0.15.json` -> `0.15`. */
const SCHEMA_VERSION_TOKEN: RegExp = /dsh-plugin-([0-9]+\.[0-9]+)\.json$/
/** A stable plugin id: lowercase alphanumerics plus `.`, `_` and `-`, with at least one dot. */
const PLUGIN_ID: RegExp = /^[a-z0-9][a-z0-9._-]+$/
/** A credential reference on the TUI plane: the tokens R2's evidence names. */
const CREDENTIAL_REFERENCE: RegExp = /apiKey|api_key|credential/i
/** A stdout diagnostic the R3 rule forbids on the TUI plane. */
const STDOUT_WRITE: RegExp = /console\.log\(/
/** A mutating filesystem call, used to prove the bundle writes nothing under `~/.dsh-tui`. */
const MUTATING_FS: RegExp = /\b(writeFileSync|appendFileSync|mkdirSync|renameSync|rmSync|createWriteStream|writeFile|appendFile|mkdir)\s*\(/
/** A manifest key that would carry an artifact digest, which would make the "no Verified claim" bound stale. */
const DIGEST_KEY: RegExp = /^(digest|artifact|sha256)$/i
/** The package name an installed dsh-TUI host's `package.json` must carry. */
const HOST_PACKAGE_NAME: string = "@deepseek-harness-tui/dsh-tui"
/** The distribution descriptor whose `host-tui` component ref the band must cover. */
const DISTRIBUTION_FILE: string = "dsh-distribution.json"
/** The component id in {@link DISTRIBUTION_FILE} that carries the TUI host coordinate. */
const DISTRIBUTION_HOST_COMPONENT: string = "host-tui"
/** One `compat.hosts` entry: an `@scope/name@x.y.z` coordinate (a prerelease/build suffix is allowed). */
const HOST_COORDINATE: RegExp = /^(@[^/@\s]+\/[^@\s/]+)@(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)$/
/** One `dsh-distribution.json` component ref: the `pkg:npm/` spelling of the same coordinate. */
const PACKAGE_REF: RegExp = /^(?:pkg:npm\/)?(@[^@\s/]+\/[^@\s/]+)@(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)$/
/** The host modules the admission chain lives in, relative to the host package root. */
const HOST_MODULES: { readonly manifest: string; readonly registry: string; readonly admission: string; readonly descriptor: string; readonly constants: string } = {
  manifest: "node_modules/@dsh-std/manifest/lib/index.js",
  registry: "lib/types/adapter/standard/registry.js",
  admission: "lib/types/adapter/standard/admission.js",
  descriptor: "lib/types/adapter/standard/descriptor.js",
  constants: "lib/types/adapter/spec/protocol-constants.js",
}

// ─── THE R5 ALLOWANCE (a named deviation, not a silent pass) ──────────────────────────────────────

/** One user-data root the R5 deviation records, with the bytes that prove it is still written. */
interface R5RootRecord {
  /** The home root the deviation names, in the docs' `~` spelling. */
  readonly root: string
  /** Repository-relative file whose bytes are the evidence that the root is still written. */
  readonly evidenceFile: string
  /** Every pattern that must still appear in that file; a miss makes the record STALE. */
  readonly patterns: readonly string[]
}

/** The R5 deviation as this gate enforces it: the roots, their evidence and the docs that carry it. */
const R5_DEVIATION: { readonly id: string; readonly rule: string; readonly docs: readonly string[]; readonly roots: readonly R5RootRecord[] } = {
  id: "R5",
  rule: "user data only under the existing ~/.dsh-tui locations",
  docs: ["docs/tui-admission.md", "docs/tui-admission.zh-CN.md"],
  roots: [
    { root: "~/.mpd/workmate", evidenceFile: "packages/mpd-workmate-plugin/src/index.ts", patterns: ['join(homeDir(), ".mpd", "workmate")'] },
    { root: "~/.mpd/memory", evidenceFile: "packages/mpd-memory-plugin/src/store.ts", patterns: ['join(homeDir(), ".mpd", "memory")'] },
    { root: "~/.mpd/codegraph", evidenceFile: "packages/mpd-mcp-codegraph/dist/serve.js", patterns: ['join(homeDir, ".mpd", "codegraph")'] },
  ],
}

// ─── TYPES ────────────────────────────────────────────────────────────────────────────────────────

/** The status one arm reports: a pass, a finding, a declared bound, or the named R5 allowance. */
type ArmStatus = "pass" | "fail" | "bound" | "deviation"

/** One line of the gate's report: the rule id, its outcome and the measured detail. */
interface ArmResult {
  /** The stable arm id this report and the docs cite, e.g. `A.schema` or `H.chain:bundle`. */
  readonly id: string
  /** The outcome; only `fail` reddens the gate. */
  readonly status: ArmStatus
  /** One line of measured detail: what was checked and what was observed. */
  readonly detail: string
}

/** One source file's repository-relative path and its full text, for the text-scan arms. */
interface SourceText {
  /** Repository-relative path, as reported in a finding. */
  readonly file: string
  /** The file's decoded text. */
  readonly text: string
}

/** A manifest that was read and parsed into a plain record, with the bytes the host arm also feeds. */
interface ManifestLoaded {
  /** Always true: this is the readable arm. */
  readonly ok: true
  /** The path as the caller named it (repository-relative, or absolute in fixture mode). */
  readonly file: string
  /** The absolute path the bytes were read from. */
  readonly absolute: string
  /** The UTF-8 text, kept so the host arm feeds the same bytes the static arm saw. */
  readonly text: string
  /** The parsed JSON object; the static rules read it defensively. */
  readonly doc: Record<string, unknown>
}

/** A manifest that could not be read, with the reason the report names. */
interface ManifestUnreadable {
  /** Always false: this is the unreadable arm. */
  readonly ok: false
  /** The path as the caller named it. */
  readonly file: string
  /** The absolute path that was probed. */
  readonly absolute: string
  /** Why the manifest could not be read or parsed. */
  readonly message: string
}

/** The two arms reading one manifest can produce. */
type ManifestRead = ManifestLoaded | ManifestUnreadable

/** One parsed host coordinate from a manifest's `compat.hosts` band. */
interface HostCoordinate {
  /** The package the coordinate names, e.g. `@deepseek-harness-tui/dsh-tui`. */
  readonly name: string
  /** The exact version the coordinate pins, e.g. `0.19.0`. */
  readonly version: string
  /** The coordinate exactly as the manifest spells it, so a finding quotes the claim verbatim. */
  readonly text: string
}

/** One manifest's declared host band, or the reason its `compat.hosts` cannot be read as one. */
interface HostBand {
  /** The manifest the band was read from, as the run names it. */
  readonly file: string
  /** The parsed coordinates in declaration order; empty when the band is unusable. */
  readonly coordinates: readonly HostCoordinate[]
  /** Why the band is unusable, or undefined when it is a well-formed non-empty band. */
  readonly problem: string | undefined
}

/** One parsed command line. */
interface CliOptions {
  /** True when `--self-test` asked for the host-free fixture sweep. */
  readonly selfTest: boolean
  /** True when `--static-only` asked for the static arms alone, which is NOT an admission verdict. */
  readonly staticOnly: boolean
  /** True when `--help` asked for the usage text. */
  readonly help: boolean
  /** Every `--manifest` path, in order; a non-empty list selects fixture mode. */
  readonly manifests: readonly string[]
  /** The `--host-dir` restriction, or undefined when discovery may use every candidate. */
  readonly hostDir: string | undefined
  /** The `--json` output path, or undefined when no record file was asked for. */
  readonly jsonOut: string | undefined
}

/** One discovery probe of the installed host, kept so a failed run can print what it tried. */
interface HostProbe {
  /** Which candidate family this probe came from, e.g. `$MPD_DSH_TUI_HOST` or `profile <dir>`. */
  readonly source: string
  /** The directory probed, or undefined when the candidate is an unset environment variable. */
  readonly dir: string | undefined
  /** Why this candidate is not a usable host, or undefined when it is one. */
  readonly problem: string | undefined
}

/** The host's own admission entry points, extracted from the installed payload's modules. */
interface HostChain {
  /** The host's own manifest parser. */
  readonly parseManifest: (source: string, options: { readonly source: string }) => unknown
  /** The host's own manifest projection. */
  readonly projectManifest: (manifest: unknown) => unknown
  /** The host's own spec-data loader. */
  readonly loadSpecData: () => unknown
  /** The host's own registry self-check; an empty list means the profile is intact. */
  readonly verifyRegistry: (data: unknown) => readonly unknown[]
  /** The host's own contract-profile self-check; an empty list means the profile is intact. */
  readonly verifyContractProfiles: (data: unknown) => readonly unknown[]
  /** The host's own contract index builder. */
  readonly createContractIndex: (registry: unknown, permissions: unknown) => unknown
  /** The host's own manifest validator, throwing on the first violation. */
  readonly validatePlugin: (index: unknown, manifest: unknown) => void
  /** The host's own five-state negotiation. */
  readonly negotiate: (index: unknown, manifest: unknown, host: unknown, grants: readonly unknown[]) => unknown
  /** The host's own legacy-compatibility descriptor builder. */
  readonly buildLegacyHostDescriptor: (options: Record<string, unknown>) => unknown
  /** The contracts the installed host can support, read from its own pinned registry. */
  readonly supportedContracts: readonly unknown[]
}

/** What the host arm measured, recorded beside its arms for the evidence file. */
interface HostReport {
  /** Absolute root of the installed host package. */
  readonly root: string
  /** The host package's own version. */
  readonly version: string
  /** The spec-data directory the host's `loadSpecData()` resolved. */
  readonly specDir: string
  /** The coordinates the descriptor advertised, as `apiVersion#kind`. */
  readonly contracts: readonly string[]
  /** The descriptor builder's own warnings (the legacy-compatibility declaration is one of them). */
  readonly warnings: readonly string[]
  /** One decision per manifest. */
  readonly decisions: readonly { readonly manifest: string; readonly decision: string; readonly reasonCode: string | undefined }[]
}

/** The host arm's outcome: its arms, the measurement, and whether the arm could RUN at all. */
interface HostArmOutcome {
  /** The host arm's arms, one per step. */
  readonly arms: readonly ArmResult[]
  /** The host measurement, absent when the host arm could not run. */
  readonly host: HostReport | undefined
  /** True only when no installed host resolved, so the run is NOT PASSED rather than failed on merit. */
  readonly notPassed: boolean
}

/** One self-test arm's recorded outcome. */
interface SelfTestArm {
  /** The arm's name, printed in the census. */
  readonly name: string
  /** True when the arm held. */
  readonly ok: boolean
  /** One line stating what was observed. */
  readonly note: string
}

// ─── SMALL HELPERS ───────────────────────────────────────────────────────────────────────────────

/** Write one line of this gate's report to stdout, always with the run's tag. */
function say(line: string): void {
  console.log(TAG + " " + line)
}

/** Narrow an unknown value to a plain record, or undefined when it is null, an array or a scalar. */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined
  // A cast is the only way to read keys of a value that passed the runtime check above; the type
  // declarations of a third-party document are not available to this script.
  return value as Record<string, unknown>
}

/** Read a non-empty string field from a record, or undefined when absent or not a string. */
function stringField(record: Record<string, unknown>, key: string): string | undefined {
  /** The field's value, as the record carries it. */
  const value = record[key]
  return typeof value === "string" && value.length > 0 ? value : undefined
}

/** Read an array field from a record, or undefined when absent or not an array. */
function arrayField(record: Record<string, unknown>, key: string): readonly unknown[] | undefined {
  /** The field's value, as the record carries it. */
  const value = record[key]
  return Array.isArray(value) ? value : undefined
}

/** Build one arm result; every rule pushes exactly one, so the report is never partial. */
function arm(id: string, status: ArmStatus, detail: string): ArmResult {
  return { id, status, detail }
}

/** Render a value for a finding line without ever throwing on a cyclic or exotic value. */
function show(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value)
  if (value === undefined) return "(absent)"
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

/** Read one captured child stream as text, whether the spawn returned a Buffer or a string. */
function captured(value: string | Buffer | null | undefined): string {
  return String(value ?? "")
}

/** Read a repository-relative file's text, or undefined when it does not exist. */
function readRepoFile(file: string): string | undefined {
  /** The absolute path of the repository-relative file. */
  const absolute = resolve(REPO, file)
  if (!existsSync(absolute)) return undefined
  return readFileSync(absolute, "utf8")
}

/** A short label for a manifest path, used in arm ids and the report. */
function manifestLabel(file: string): string {
  if (file === DEFAULT_MANIFESTS[0]) return "bundle"
  if (file === DEFAULT_MANIFESTS[1]) return "package"
  // A caller-supplied path is a FIXTURE: the label must be stable for the self-test's red-id matching.
  return "fixture"
}

/** Read and parse one manifest, never throwing: an unreadable file becomes a named finding. */
function readManifest(file: string): ManifestRead {
  /** The absolute path the caller's path resolves to. */
  const absolute = resolve(REPO, file)
  if (!existsSync(absolute)) return { ok: false, file, absolute, message: "the file does not exist" }
  /** The manifest bytes, kept for the host arm so both arms judge the same bytes. */
  const text = readFileSync(absolute, "utf8")
  /** The decoded document, still unknown until the record check below. */
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    return { ok: false, file, absolute, message: "JSON.parse failed: " + (error instanceof Error ? error.message : String(error)) }
  }
  /** The parsed document as a plain record, or undefined when it is not an object. */
  const doc = asRecord(parsed)
  if (doc === undefined) return { ok: false, file, absolute, message: "the manifest is not a JSON object" }
  return { ok: true, file, absolute, text, doc }
}

/** List every `.ts` file under one absolute directory, recursively; a missing tree yields none. */
function tsFilesUnder(directory: string): string[] {
  if (!existsSync(directory)) return []
  /** The files collected so far. */
  const found: string[] = []
  /** Walk one directory, descending into subdirectories in name order. */
  const walk = (dir: string): void => {
    /** The directory's entries, or none when it cannot be read. */
    let entries: Dirent[]
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      /** The entry's absolute path. */
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full)
        continue
      }
      if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) found.push(full)
    }
  }
  walk(directory)
  return found.sort()
}

/** Collect the text of every `.ts` file under the given repository-relative directories. */
function collectSources(directories: readonly string[]): SourceText[] {
  /** The collected sources, once both roots have been walked. */
  const sources: SourceText[] = []
  for (const directory of directories) {
    for (const absolute of tsFilesUnder(resolve(REPO, directory))) {
      sources.push({ file: relative(REPO, absolute).split("\\").join("/"), text: readFileSync(absolute, "utf8") })
    }
  }
  return sources
}

/** Collect the two TUI packages' sources: the plane R2 and R3 are stated about. */
function tuiSources(): SourceText[] {
  return collectSources(TUI_SOURCE_DIRS)
}

/** Collect every package's `src` tree, for the bundle-wide `~/.dsh-tui` write check. */
function packageSources(): SourceText[] {
  /** The repository-relative directories under `packages/`, one per package. */
  const directories: string[] = []
  /** The packages root, read once. */
  const packagesDir = resolve(REPO, "packages")
  if (!existsSync(packagesDir)) return []
  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (entry.isDirectory()) directories.push(join("packages", entry.name, "src"))
  }
  return collectSources(directories)
}

// ─── STATIC ARMS: ONE MANIFEST ───────────────────────────────────────────────────────────────────

/** The finding for one contract entry that breaks the declaration rules, or undefined when it holds. */
function contractFinding(value: unknown): string | undefined {
  /** The contract entry as a record, when it is one. */
  const entry = asRecord(value)
  if (entry === undefined) return "a contract entry is not an object: " + show(value)
  if (stringField(entry, "apiVersion") === undefined) return "a contract entry carries no apiVersion: " + show(value)
  if (stringField(entry, "kind") === undefined) return "a contract entry carries no kind: " + show(value)
  // An OPTIONAL contract must state its fallback in writing; a required one needs no fallback.
  if (entry["optional"] === true && stringField(entry, "fallback") === undefined) {
    return "an optional contract carries no written fallback: " + show(value)
  }
  return undefined
}

/** The finding for one declared permission that the TUI source never references, or undefined. */
function permissionFinding(value: unknown, sources: readonly SourceText[]): string | undefined {
  /** The permission entry as a record, when it is one. */
  const entry = asRecord(value)
  if (entry === undefined) return "a permission entry is not an object: " + show(value)
  /** The permission name the host registry keys on. */
  const name = stringField(entry, "name")
  if (name === undefined) return "a permission entry carries no name: " + show(value)
  if (stringField(entry, "scope") === undefined) return "permission " + name + " carries no scope"
  // A declared-but-unused permission is exactly what the guide's "permissions must be declared and
  // actually requested" rule refuses: a manifest that asks for a capability its code never uses is a
  // permission grant waiting to be granted for nothing.
  if (!sources.some((source) => source.text.includes(name))) {
    return "permission " + name + " is declared but never referenced in the TUI source"
  }
  return undefined
}

/** Every static arm that reads ONE manifest's own bytes; an unreadable manifest collapses to one arm. */
function manifestArms(load: ManifestLoaded, sources: readonly SourceText[]): ArmResult[] {
  /** The arms produced for this manifest, in rule order. */
  const arms: ArmResult[] = []
  /** The manifest's document, read through the defensive accessors below. */
  const doc = load.doc
  /** The declared `$schema`, when it is a string. */
  const schema = stringField(doc, "$schema")
  /** The declared manifest version, when it is a string. */
  const version = stringField(doc, "manifestVersion")
  /** The schema URI's own version token, derived from its file name. */
  const schemaToken = schema === undefined ? undefined : (SCHEMA_VERSION_TOKEN.exec(schema)?.[1] ?? undefined)
  /** The declared plugin id, when it is a string. */
  const id = stringField(doc, "id")
  /** The facet declarations, when they are a record. */
  const facets = asRecord(doc["facets"])
  /** The host facet, when it is a record. */
  const host = facets === undefined ? undefined : asRecord(facets["host"])
  /** The host facet's entry module path, when it is a string. */
  const entry = host === undefined ? undefined : stringField(host, "entry")
  /** The host facet's declared apiVersion, when it is a string. */
  const facetApiVersion = host === undefined ? undefined : stringField(host, "apiVersion")
  /** The requirement block, when it is a record. */
  const requires = asRecord(doc["requires"])
  /** The declared contracts, when they are an array. */
  const contracts = requires === undefined ? undefined : arrayField(requires, "contracts")
  /** The declared permissions, when they are an array. */
  const permissions = arrayField(doc, "permissions")
  /** The declared subscriptions, when they are an array. */
  const subscriptions = arrayField(doc, "subscriptions")
  /** The contribution block, when it is a record. */
  const contributes = asRecord(doc["contributes"])
  /** The declared commands, when they are an array. */
  const commands = contributes === undefined ? undefined : arrayField(contributes, "commands")

  // A · the schema is an absolute URI (the guide's "no network fetch required" rule).
  arms.push(
    schema !== undefined && ABSOLUTE_URI.test(schema)
      ? arm("A.schema", "pass", "$schema is the absolute URI " + schema)
      : arm("A.schema", "fail", "$schema must be an absolute URI (scheme://…), got " + show(schema)),
  )

  // A · manifestVersion is 0.15 AND the schema URI names the same version.
  arms.push(
    version === MANIFEST_VERSION && schemaToken === MANIFEST_VERSION
      ? arm("A.manifest-version", "pass", "manifestVersion is " + MANIFEST_VERSION + " and the $schema token agrees")
      : arm("A.manifest-version", "fail", "manifestVersion " + show(version) + " must be " + MANIFEST_VERSION + " and the $schema version token " + show(schemaToken) + " must agree"),
  )

  // A · a stable, unique plugin id in the identity shape the registry keys on.
  arms.push(
    id !== undefined && PLUGIN_ID.test(id) && id.includes(".")
      ? arm("A.id", "pass", "the plugin id is " + id)
      : arm("A.id", "fail", "a stable plugin id in reverse-DNS shape is required, got " + show(id)),
  )

  // A · facets.host names an entry AND an apiVersion.
  arms.push(
    entry !== undefined && facetApiVersion !== undefined
      ? arm("A.host-facet", "pass", "facets.host names " + entry + " at apiVersion " + facetApiVersion)
      : arm("A.host-facet", "fail", "facets.host must name both an entry and an apiVersion; entry=" + show(entry) + " apiVersion=" + show(facetApiVersion)),
  )

  // A · the declared entry module resolves from THIS manifest's own directory.
  /** The absolute entry path the manifest's own directory implies. */
  const entryPath = entry === undefined ? undefined : resolve(dirname(load.absolute), entry)
  arms.push(
    entryPath !== undefined && existsSync(entryPath)
      ? arm("A.host-entry", "pass", "the facet entry resolves to " + relative(REPO, entryPath).split("\\").join("/"))
      : arm("A.host-entry", "fail", "the facet entry does not resolve from the manifest's directory: " + show(entry)),
  )

  // A · no client/worker facet: v0.15 rejects both outright, and a licence surface does not soften it.
  arms.push(
    facets !== undefined && !Object.hasOwn(facets, "client") && !Object.hasOwn(facets, "worker")
      ? arm("A.facets", "pass", "no client or worker facet is declared")
      : arm("A.facets", "fail", "a client/worker facet is rejected in v0.15 (no licence surface legalizes it)"),
  )

  // A · the licence and the source repository are locatable.
  /** The licence identifier the manifest declares. */
  const license = stringField(doc, "license")
  /** The source block, when it is a record. */
  const source = asRecord(doc["source"])
  /** The source repository URL, when it is a string. */
  const repository = source === undefined ? undefined : stringField(source, "repository")
  if (license !== undefined && existsSync(resolve(REPO, "LICENSE.md")) && repository !== undefined && ABSOLUTE_URI.test(repository)) {
    arms.push(arm("A.licence", "pass", "licence " + license + " with LICENSE.md at the repo root and source " + repository))
  } else {
    arms.push(arm("A.licence", "fail", "the licence surface must be locatable: license=" + show(license) + " LICENSE.md=" + String(existsSync(resolve(REPO, "LICENSE.md"))) + " repository=" + show(repository)))
  }

  // B · every contract coordinate is declared and every optional contract carries a fallback.
  /** The first contract-rule violation, when there is one. */
  const contractProblem = contracts === undefined ? "requires.contracts must be an array" : contracts.map(contractFinding).find((finding) => finding !== undefined)
  arms.push(
    contractProblem === undefined
      ? arm("B.contracts", "pass", String(contracts?.length ?? 0) + " contract(s) declared; every optional one carries a written fallback")
      : arm("B.contracts", "fail", contractProblem),
  )

  // B · the removed-in-v0.15 `provides` / `requires.services` keys must not reappear.
  /** True when the document still carries one of the two removed keys. */
  const removedKey = Object.hasOwn(doc, "provides") ? "provides" : requires !== undefined && Object.hasOwn(requires, "services") ? "requires.services" : undefined
  arms.push(
    removedKey === undefined
      ? arm("B.no-provides", "pass", "neither provides nor requires.services is declared")
      : arm("B.no-provides", "fail", "`" + removedKey + "` is rejected in v0.15 and must not appear"),
  )

  // B · permissions are declared as an array, shaped correctly, and none is declared unused.
  /** The first permission-rule violation, when there is one. */
  const permissionProblem = permissions === undefined ? "permissions must be an array" : permissions.map((value) => permissionFinding(value, sources)).find((finding) => finding !== undefined)
  arms.push(
    permissionProblem === undefined
      ? arm("B.permissions", "pass", permissions !== undefined && permissions.length === 0 ? "no permission is declared (nothing unused)" : String(permissions?.length ?? 0) + " permission(s) declared, each referenced by the TUI source")
      : arm("B.permissions", "fail", permissionProblem),
  )

  // B · subscriptions are declared as an array of named rows.
  /** The first subscription-rule violation, when there is one. */
  const subscriptionProblem =
    subscriptions === undefined
      ? "subscriptions must be an array"
      : subscriptions.map((value) => (asRecord(value) === undefined ? "a subscription entry is not an object: " + show(value) : stringField(asRecord(value) ?? {}, "name") === undefined ? "a subscription entry carries no name: " + show(value) : undefined)).find((finding) => finding !== undefined)
  arms.push(
    subscriptionProblem === undefined ? arm("B.subscriptions", "pass", String(subscriptions?.length ?? 0) + " subscription(s) declared") : arm("B.subscriptions", "fail", subscriptionProblem),
  )

  // B · contributes.commands is declared as an array (the host's effect ledger reads it).
  /** The first commands-rule violation, when there is one. */
  const commandProblem =
    commands === undefined
      ? "contributes.commands must be an array"
      : commands.map((value) => (asRecord(value) === undefined ? "a command entry is not an object: " + show(value) : stringField(asRecord(value) ?? {}, "name") === undefined ? "a command entry carries no name: " + show(value) : undefined)).find((finding) => finding !== undefined)
  arms.push(
    commandProblem === undefined ? arm("B.commands", "pass", String(commands?.length ?? 0) + " TUI command(s) declared") : arm("B.commands", "fail", commandProblem),
  )

  // C · no Backend contribution: TUI-BACKEND-001 does not apply and no backend picker entry exists.
  /** True when a Backend contract coordinate is declared. */
  const backendContract = contracts !== undefined && contracts.some((value) => stringField(asRecord(value) ?? {}, "kind") === "Backend")
  /** True when the contribution block names a backend. */
  const backendContribution = contributes !== undefined && (Object.hasOwn(contributes, "backends") || Object.hasOwn(contributes, "backend"))
  arms.push(
    !backendContract && !backendContribution
      ? arm("C.no-backend", "pass", "no Backend contribution is declared")
      : arm("C.no-backend", "fail", "a Backend contribution is declared; docs/tui-admission.md §6 says none exists"),
  )

  // R1 · the recorded PASS rests on `subscriptions: []`; a non-empty list reopens the rule.
  arms.push(
    subscriptions !== undefined && subscriptions.length === 0
      ? arm("R1.subscriptions-empty", "pass", "subscriptions is empty, which is what R1's PASS rests on")
      : arm("R1.subscriptions-empty", "fail", "subscriptions must stay empty; a non-empty list reopens R1 and docs/tui-admission.md §5 must move in the same change"),
  )

  return arms
}

// ─── STATIC ARMS: THE PAIR, AND THE REPOSITORY ───────────────────────────────────────────────────

/** The pair-level arms: the two manifests are ONE identity declared for two packaging shapes. */
function pairArms(loads: readonly ManifestLoaded[]): ArmResult[] {
  /** The arms produced by the pair checks. */
  const arms: ArmResult[] = []
  // Every caller guards the pair's length and readability, so the two entries are stated here.
  /** The first manifest's document, already known readable. */
  const first = loads[0]?.doc ?? {}
  /** The second manifest's document, already known readable. */
  const second = loads[1]?.doc ?? {}
  /** The id the first manifest declares, when it is a string. */
  const firstId = stringField(first, "id")
  /** The id the second manifest declares, when it is a string. */
  const secondId = stringField(second, "id")
  arms.push(
    firstId !== undefined && firstId === secondId
      ? arm("A.id-parity", "pass", "both manifests declare the id " + firstId)
      : arm("A.id-parity", "fail", "the two manifests declare different ids: " + show(firstId) + " vs " + show(secondId)),
  )

  // The identity fields the manifests' own note says never diverge: licence, facet apiVersion,
  // permissions and the contract coordinates.
  /** Normalized identity values, one per compared field. */
  const identityOf = (doc: Record<string, unknown>): Record<string, unknown> => {
    /** The facet block of the document, when it is a record. */
    const facets = asRecord(doc["facets"])
    /** The host facet of the document, when it is a record. */
    const host = facets === undefined ? undefined : asRecord(facets["host"])
    /** The requirement block of the document, when it is a record. */
    const requires = asRecord(doc["requires"])
    /** The declared contracts, when they are an array. */
    const contracts = requires === undefined ? undefined : arrayField(requires, "contracts")
    return {
      license: doc["license"],
      facetApiVersion: host === undefined ? undefined : host["apiVersion"],
      permissions: arrayField(doc, "permissions") ?? [],
      contracts: (contracts ?? []).map((value) => {
        /** One contract entry as a record. */
        const entry = asRecord(value) ?? {}
        return [entry["apiVersion"], entry["kind"], entry["optional"], entry["fallback"]]
      }),
    }
  }
  /** The two normalized identity records, rendered for comparison. */
  const left = JSON.stringify(identityOf(first))
  /** The second normalized identity record, rendered for comparison. */
  const right = JSON.stringify(identityOf(second))
  arms.push(
    left === right
      ? arm("A.identity-parity", "pass", "licence, facet apiVersion, permissions and requires.contracts agree across both manifests")
      : arm("A.identity-parity", "fail", "the two manifests disagree on licence/facet apiVersion/permissions/contracts: " + left + " vs " + right),
  )

  // The packed copy is a DERIVED artifact: when a pack exists, its identity must still match.
  /** The packed copy's path, read only when the pack step has run. */
  const packedFile = "dist/mpd-package/dsh-plugin.json"
  if (!existsSync(resolve(REPO, packedFile))) {
    arms.push(arm("A.packed-copy", "bound", "no packed copy at " + packedFile + " (the pack step has not run); nothing to compare"))
    return arms
  }
  /** The packed copy, read and parsed like any other manifest. */
  const packed = readManifest(packedFile)
  if (!packed.ok) {
    arms.push(arm("A.packed-copy", "fail", "the packed copy cannot be read: " + packed.message))
    return arms
  }
  /** The packed copy's id, when it is a string. */
  const packedId = stringField(packed.doc, "id")
  /** The packed copy's manifest version, when it is a string. */
  const packedVersion = stringField(packed.doc, "manifestVersion")
  arms.push(
    packedId === firstId && packedVersion === MANIFEST_VERSION
      ? arm("A.packed-copy", "pass", "the packed copy keeps the identity " + firstId + " at manifestVersion " + MANIFEST_VERSION)
      : arm("A.packed-copy", "fail", "the packed copy drifted from the bundle manifest: id=" + show(packedId) + " manifestVersion=" + show(packedVersion)),
  )
  return arms
}

// ─── STATIC ARMS: THE COMPAT BAND (R6) ──────────────────────────────────────────────────────────
//
// `compat.hosts` is a PUBLICATION CLAIM, not an admission input: no host code reads it, so before this
// lane existed the field could lose a member and every gate stayed green. The lane asserts the claim
// from this repository's own bytes, and the host arm adds the one check that needs a discovered host.

/** Parse one `compat.hosts` entry as an `@scope/name@x.y.z` coordinate, or undefined. */
function parseHostCoordinate(value: unknown): HostCoordinate | undefined {
  if (typeof value !== "string") return undefined
  /** The entry's parsed parts, when it is a coordinate. */
  const match = HOST_COORDINATE.exec(value)
  if (match === null || match[1] === undefined || match[2] === undefined) return undefined
  return { name: match[1], version: match[2], text: value }
}

/** Read one manifest's declared host band without ever throwing; a defect becomes `problem`. */
function readBand(load: ManifestLoaded): HostBand {
  /** The `compat` block, when it is a record. */
  const compat = asRecord(load.doc["compat"])
  if (compat === undefined) return { file: load.file, coordinates: [], problem: "the manifest carries no compat block" }
  /** The declared `compat.hosts` list, when it is an array. */
  const hosts = arrayField(compat, "hosts")
  if (hosts === undefined) return { file: load.file, coordinates: [], problem: "compat.hosts is not an array" }
  if (hosts.length === 0) return { file: load.file, coordinates: [], problem: "compat.hosts is empty" }
  /** Every parsed coordinate, accumulated as the list is walked. */
  const coordinates: HostCoordinate[] = []
  for (const value of hosts) {
    /** The entry's parsed coordinate, when it is one. */
    const coordinate = parseHostCoordinate(value)
    if (coordinate === undefined) {
      return { file: load.file, coordinates: [], problem: "compat.hosts carries " + show(value) + ", which is not an @scope/name@x.y.z coordinate" }
    }
    coordinates.push(coordinate)
  }
  return { file: load.file, coordinates, problem: undefined }
}

/** Whether the band contains the exact package-and-version pair, which is what "inside" means here. */
function bandContains(band: HostBand, name: string, version: string): boolean {
  return band.problem === undefined && band.coordinates.some((coordinate) => coordinate.name === name && coordinate.version === version)
}

/** Render a band as one stable string, so a finding quotes the exact claim the manifest makes. */
function renderBand(band: HostBand): string {
  return "[" + band.coordinates.map((coordinate) => coordinate.text).join(", ") + "]"
}

/** The per-manifest labels for one run, disambiguated when two fixtures would share the `fixture` label. */
function manifestLabels(loads: readonly ManifestLoaded[]): string[] {
  /** How many times each label has been handed out, so a repeat gets a stable ordinal. */
  const seen = new Map<string, number>()
  return loads.map((load) => {
    /** The manifest's base label. */
    const base = manifestLabel(load.file)
    /** This occurrence's ordinal for that label. */
    const ordinal = (seen.get(base) ?? 0) + 1
    seen.set(base, ordinal)
    return ordinal === 1 ? base : base + "#" + String(ordinal)
  })
}

/** COMPAT (a) · one manifest declares a NON-EMPTY band of `@scope/name@x.y.z` coordinates. */
function bandShapeArm(load: ManifestLoaded): ArmResult {
  /** The manifest's declared band. */
  const band = readBand(load)
  if (band.problem !== undefined) {
    return arm("COMPAT.band", "fail", load.file + ": " + band.problem + "; compat.hosts must declare a non-empty band of @scope/name@x.y.z coordinates")
  }
  return arm("COMPAT.band", "pass", load.file + " declares the band " + renderBand(band))
}

/** COMPAT (b) · the two manifests declare the SAME band; a drift guard inside the gate itself. */
function bandParityArm(loads: readonly ManifestLoaded[]): ArmResult {
  /** The first manifest the run read, when the run read two. */
  const first = loads[0]
  /** The second manifest the run read, when the run read two. */
  const second = loads[1]
  if (first === undefined || second === undefined || loads.length !== 2) {
    return arm("COMPAT.band-parity", "bound", "the run read " + String(loads.length) + " manifest(s), so the two bands cannot be compared")
  }
  /** The first manifest's band. */
  const left = readBand(first)
  /** The second manifest's band. */
  const right = readBand(second)
  if (left.problem !== undefined || right.problem !== undefined) {
    return arm("COMPAT.band-parity", "bound", "a band is unusable (" + (left.problem ?? right.problem ?? "?") + "), so the two cannot be compared; COMPAT.band above carries that finding")
  }
  /** The first band, SORTED so declaration order alone is not drift but a duplicate still is. */
  const leftSet = left.coordinates.map((coordinate) => coordinate.text).sort()
  /** The second band under the same normalization. */
  const rightSet = right.coordinates.map((coordinate) => coordinate.text).sort()
  return JSON.stringify(leftSet) === JSON.stringify(rightSet)
    ? arm("COMPAT.band-parity", "pass", "both manifests declare the same band " + renderBand(left))
    : arm("COMPAT.band-parity", "fail", "the two manifests disagree on compat.hosts: " + left.file + " declares " + renderBand(left) + " while " + right.file + " declares " + renderBand(right))
}

/** The `host-tui` ref {@link DISTRIBUTION_FILE} declares, or the reason it cannot be read. */
function distributionHostRef(): { readonly ref: string | undefined; readonly problem: string | undefined } {
  /** The descriptor's text, when the file exists. */
  const text = readRepoFile(DISTRIBUTION_FILE)
  if (text === undefined) return { ref: undefined, problem: "the file does not exist" }
  /** The parsed descriptor, before it is narrowed to a record. */
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    return { ref: undefined, problem: "the file is not readable JSON: " + (error instanceof Error ? error.message : String(error)) }
  }
  /** The descriptor as a record. */
  const doc = asRecord(parsed)
  if (doc === undefined) return { ref: undefined, problem: "the file is not a JSON object" }
  for (const value of arrayField(doc, "protocols") ?? []) {
    /** One protocol entry as a record. */
    const protocol = asRecord(value)
    if (protocol === undefined) continue
    /** That entry's spec, when it carries one. */
    const spec = asRecord(protocol["spec"])
    if (spec === undefined) continue
    for (const component of arrayField(spec, "components") ?? []) {
      /** One component as a record. */
      const entry = asRecord(component)
      if (entry === undefined || stringField(entry, "id") !== DISTRIBUTION_HOST_COMPONENT) continue
      /** The component's declared ref. */
      const ref = stringField(entry, "ref")
      return ref === undefined ? { ref: undefined, problem: "the " + DISTRIBUTION_HOST_COMPONENT + " component carries no ref" } : { ref, problem: undefined }
    }
  }
  return { ref: undefined, problem: "no component with id " + DISTRIBUTION_HOST_COMPONENT + " appears in any protocol" }
}

/** COMPAT (c) · the `host-tui` ref in {@link DISTRIBUTION_FILE} is INSIDE the declared band. */
function distributionRefArm(loads: readonly ManifestLoaded[]): ArmResult {
  /** The manifest whose band the claim is checked against: the first one this run read. */
  const primary = loads[0]
  if (primary === undefined) return arm("COMPAT.distribution-ref", "bound", "no manifest was read, so no band exists to check the " + DISTRIBUTION_HOST_COMPONENT + " ref against")
  /** The band the distribution coordinate must lie inside. */
  const band = readBand(primary)
  if (band.problem !== undefined) {
    return arm("COMPAT.distribution-ref", "fail", "the declared band is unusable (" + band.problem + "), so the " + DISTRIBUTION_HOST_COMPONENT + " ref cannot be shown inside it")
  }
  /** The distribution's `host-tui` ref, with the reason it could not be read. */
  const hostRef = distributionHostRef()
  /** The ref, when the descriptor carries one. */
  const ref = hostRef.ref
  if (ref === undefined || hostRef.problem !== undefined) {
    return arm("COMPAT.distribution-ref", "fail", DISTRIBUTION_FILE + ": " + (hostRef.problem ?? "the " + DISTRIBUTION_HOST_COMPONENT + " ref is absent"))
  }
  /** The ref's parsed coordinate parts, when it is a `pkg:npm/@scope/name@x.y.z` coordinate. */
  const match = PACKAGE_REF.exec(ref)
  if (match === null || match[1] === undefined || match[2] === undefined) {
    return arm("COMPAT.distribution-ref", "fail", DISTRIBUTION_FILE + " declares the " + DISTRIBUTION_HOST_COMPONENT + " ref " + show(ref) + ", which is not a pkg:npm/@scope/name@x.y.z coordinate")
  }
  return bandContains(band, match[1], match[2])
    ? arm("COMPAT.distribution-ref", "pass", "the " + DISTRIBUTION_HOST_COMPONENT + " ref " + show(ref) + " is inside the band " + renderBand(band))
    : arm("COMPAT.distribution-ref", "fail", "the " + DISTRIBUTION_HOST_COMPONENT + " ref " + show(ref) + " is OUTSIDE the declared band " + renderBand(band) + "; a band that excludes the distribution's own host coordinate is a false publication claim")
}

/** Every COMPAT arm the static pass can decide: (a) per manifest, (b) the pair, (c) the distribution ref. */
function compatArms(loads: readonly ManifestLoaded[]): ArmResult[] {
  /** The arms produced by the band lane. */
  const arms: ArmResult[] = []
  /** The run's per-manifest labels, in load order. */
  const labels = manifestLabels(loads)
  for (let index = 0; index < loads.length; index++) {
    /** The manifest this iteration's arm judges. */
    const load = loads[index]
    if (load === undefined) continue
    /** The shape arm, renamed with this manifest's label. */
    const shaped = bandShapeArm(load)
    arms.push({ ...shaped, id: shaped.id + ":" + (labels[index] ?? "fixture") })
  }
  arms.push(bandParityArm(loads))
  arms.push(distributionRefArm(loads))
  return arms
}

/**
 * COMPAT (d) · the DISCOVERED host's exact version is inside the published band.
 *
 * `version` is undefined when the running mode discovered no host; the arm then reports NOT CHECKED as
 * a `bound`, never a silent pass. The band is read from the bundle manifest because that file is the
 * publication claim, and the host arm only runs on the shipped pair, so no fixture reaches this read.
 * @param version - the discovered host's exact version, or undefined when none was discovered.
 * @param reason - why no version is available, quoted by the NOT CHECKED report.
 * @returns the COMPAT (d) arm, `bound` when the sub-assertion could not be checked.
 */
function hostVersionArm(version: string | undefined, reason: string): ArmResult {
  if (version === undefined) {
    return arm("COMPAT.host-version", "bound", "NOT CHECKED — " + reason + ", so no discovered host version exists to compare against the band")
  }
  /** The bundle manifest the band is read from. */
  const load = readManifest(DEFAULT_MANIFESTS[0] ?? "dsh-plugin.json")
  if (!load.ok) return arm("COMPAT.host-version", "fail", "the bundle manifest cannot be read: " + load.message)
  /** The band the discovered host must lie inside. */
  const band = readBand(load)
  if (band.problem !== undefined) {
    return arm("COMPAT.host-version", "fail", "the declared band is unusable (" + band.problem + "), so the discovered host " + version + " cannot be shown inside it")
  }
  return bandContains(band, HOST_PACKAGE_NAME, version)
    ? arm("COMPAT.host-version", "pass", "the discovered host " + HOST_PACKAGE_NAME + " " + version + " is inside the declared band " + renderBand(band))
    : arm("COMPAT.host-version", "fail", "the discovered host " + HOST_PACKAGE_NAME + " " + version + " is OUTSIDE the declared band " + renderBand(band) + "; this run measured a host the publication claim excludes")
}

/** R2 · no credential reference exists on the TUI plane (the tokens the page names). */
function credentialArm(sources: readonly SourceText[]): ArmResult {
  /** The first file whose text carries a credential reference. */
  const hit = sources.find((source) => CREDENTIAL_REFERENCE.test(source.text))
  return hit === undefined
    ? arm("R2.credentials", "pass", "no apiKey/api_key/credential reference in " + String(sources.length) + " TUI source file(s)")
    : arm("R2.credentials", "fail", "a credential reference appears in " + hit.file + "; credential handling stays in the harness")
}

/** R3 · stdout stays quiet: no `console.log` diagnostic anywhere on the TUI plane. */
function stdoutArm(sources: readonly SourceText[]): ArmResult {
  /** The first file whose text carries a console.log call. */
  const hit = sources.find((source) => STDOUT_WRITE.test(source.text))
  return hit === undefined
    ? arm("R3.stdout", "pass", "no console.log call in " + String(sources.length) + " TUI source file(s)")
    : arm("R3.stdout", "fail", "console.log appears in " + hit.file + "; debug output goes to stderr through the host's debug flags")
}

/** R7 · the render path's width primitive is the cell-aware `cellWidth`, not `string.length`. */
function cellWidthArm(sources: readonly SourceText[]): ArmResult {
  /** The sanitize module, where the width primitive lives. */
  const sanitize = sources.find((source) => source.file === "packages/mpd-tui-plugin/src/sanitize.ts")
  if (sanitize === undefined) return arm("R7.cell-width", "fail", "packages/mpd-tui-plugin/src/sanitize.ts is missing; the width primitive cannot be located")
  return sanitize.text.includes("export function cellWidth(")
    ? arm("R7.cell-width", "pass", "cellWidth is the exported width primitive the render path consumes (BMP bound recorded in docs §5 R7)")
    : arm("R7.cell-width", "fail", "sanitize.ts no longer exports cellWidth")
}

/** D · the TUI plugin exports a synchronous `apply`, the facet entry the manifest names. */
function applyArm(): ArmResult {
  /** The TUI plugin's entry source. */
  const entrySource = readRepoFile("packages/mpd-tui-plugin/src/index.ts")
  if (entrySource === undefined) return arm("D.apply-export", "fail", "packages/mpd-tui-plugin/src/index.ts is missing; the facet entry cannot be read")
  return /export function apply\(/.test(entrySource)
    ? arm("D.apply-export", "pass", "the TUI plugin exports a synchronous apply(ctx, config)")
    : arm("D.apply-export", "fail", "the TUI plugin no longer exports apply as a function declaration")
}

/** D · the cleanup test the page cites as D's evidence still exists and still counts disposals. */
function cleanupArm(): ArmResult {
  /** The test the page cites for cleanup ownership. */
  const testSource = readRepoFile("packages/mpd-tui-plugin/test/plugin.test.ts")
  if (testSource === undefined) return arm("D.cleanup-test", "fail", "packages/mpd-tui-plugin/test/plugin.test.ts is missing; D's cleanup evidence has no home")
  return testSource.includes("disposed")
    ? arm("D.cleanup-test", "pass", "plugin.test.ts still records and counts disposers")
    : arm("D.cleanup-test", "fail", "plugin.test.ts no longer counts disposals; D's cleanup evidence is stale")
}

/** R5 · each recorded user-data root is still written exactly where the deviation says. */
function r5RecordArm(roots: readonly R5RootRecord[]): ArmResult {
  /** One human-readable problem per stale record. */
  const problems: string[] = []
  for (const record of roots) {
    /** The evidence file's text, or undefined when the file moved. */
    const text = readRepoFile(record.evidenceFile)
    if (text === undefined) {
      problems.push(record.root + ": evidence file " + record.evidenceFile + " is missing")
      continue
    }
    for (const pattern of record.patterns) {
      if (!text.includes(pattern)) problems.push(record.root + ": " + record.evidenceFile + " no longer carries " + pattern)
    }
  }
  return problems.length === 0
    ? arm("R5.records", "pass", "the three recorded roots are still written: " + roots.map((record) => record.root).join(", "))
    : arm("R5.records", "fail", "the R5 deviation record is STALE — " + problems.join("; ") + " (update docs §5.1 and this gate in the same change)")
}

/** R5 · both docs still carry the named deviation, its three roots and its FAIL verdict. */
function r5DocArm(docs: readonly string[]): ArmResult {
  /** One problem per doc that no longer carries the record. */
  const problems: string[] = []
  for (const doc of docs) {
    /** The doc's text, or undefined when it moved. */
    const text = readRepoFile(doc)
    if (text === undefined) {
      problems.push(doc + " is missing")
      continue
    }
    /** The tokens the record requires the doc to carry: the rule id, the deviated root namespace, every recorded root and the verdict. */
    const required = [R5_DEVIATION.id, "~/.dsh-tui", ...R5_DEVIATION.roots.map((record) => record.root), "FAIL"]
    /** The tokens this doc is missing. */
    const missing = required.filter((token) => !text.includes(token))
    if (missing.length > 0) problems.push(doc + " is missing " + missing.join(", "))
  }
  return problems.length === 0
    ? arm("R5.allowance", "deviation", "R5 fails by recorded decision (docs §5.1): the three ~/.mpd roots are written outside ~/.dsh-tui; ALLOWED, never a PASS")
    : arm("R5.allowance", "fail", "the R5 allowance is no longer recorded in both docs: " + problems.join("; "))
}

/** R5 · no source under any `packages/<pkg>/src` writes into `~/.dsh-tui`. */
function r5WriteArm(sources: readonly SourceText[]): ArmResult {
  /** The first line that pairs a `.dsh-tui` path with a mutating filesystem call. */
  let hit: string | undefined
  for (const source of sources) {
    for (const line of source.text.split("\n")) {
      if (line.includes(".dsh-tui") && MUTATING_FS.test(line)) {
        hit = source.file + ": " + line.trim()
        break
      }
    }
    if (hit !== undefined) break
  }
  // Declared bound: the scan is line-based, so a write built on a different line from the path would
  // escape it. Every current reference is a READ of a host-owned path; the line scan is what keeps the
  // record falsifiable without an AST pass over the whole package tree.
  return hit === undefined
    ? arm("R5.no-dsh-tui-writes", "pass", "no mutating fs call on a .dsh-tui path in " + String(sources.length) + " package source file(s) (line-based bound)")
    : arm("R5.no-dsh-tui-writes", "fail", "a write under ~/.dsh-tui appears at " + hit + "; the R5 deviation and docs §5.1 must move in the same change")
}

/** A6 · the "no Verified claim / no artifact digest" bound is still accurate. */
function digestArm(loads: readonly ManifestLoaded[]): ArmResult {
  /** The first manifest key that looks like an artifact digest. */
  /** The manifest whose document carries the key, for the finding line. */
  let hit: string | undefined
  for (const load of loads) {
    for (const key of Object.keys(load.doc)) {
      if (DIGEST_KEY.test(key)) hit = load.file + " carries `" + key + "`"
    }
  }
  return hit === undefined
    ? arm("A6.no-digest", "bound", "no artifact digest is recorded, so no Verified claim is possible; this blocks a claim, not admission (docs §6)")
    : arm("A6.no-digest", "fail", "the no-Verified-digest bound is stale: " + hit + " — docs §6 says no digest exists")
}

/** D · the recorded runtime residual, re-checked so the bound cannot go stale. */
function dResidualArm(source: string | undefined): ArmResult {
  if (source === undefined) return arm("D.residual", "fail", "the TUI adapter source is missing; the recorded D residual cannot be checked")
  // The recorded shape: `effectOn` wraps the ownership call and catches with a COMMENT-ONLY body, so a
  // scope that cannot own an effect has no diagnosable, retryable state left behind.
  /** True while `effectOn` still catches with an empty body. */
  const stillPresent = /export function effectOn\([\s\S]*?catch\s*\{\s*(?:\/\/[^\n]*\s*)*\}/.test(source)
  return stillPresent
    ? arm("D.residual", "bound", "D stays PARTIAL: effectOn catches with a comment-only body (a scope that cannot own an effect fails silently) and no activation/runtime-generation id is recorded (docs §4 D)")
    : arm("D.residual", "fail", "the D residual record is STALE: effectOn no longer swallows the ownership call, or the function moved — update docs §4 D and this gate together")
}

/** E · the recorded cleanup residual, re-checked so the bound cannot go stale. */
function eResidualArm(matrix: string | undefined): ArmResult {
  if (matrix === undefined) return arm("E.residual", "fail", "the pinned conformance matrix is missing; the recorded E residual cannot be checked")
  return matrix.includes("TUI-OBS-002")
    ? arm("E.residual", "fail", "the pinned conformance matrix now carries a TUI-OBS-002 row; docs §4 E's `not automated` record is STALE — update it in the same change")
    : arm("E.residual", "bound", "TUI-OBS-002 has no automated evaluator: the pinned matrix carries no row and no lane certifies docs/tui.md §2.1 (docs §4 E)")
}

// ─── STATIC ORCHESTRATION ────────────────────────────────────────────────────────────────────────

/** Run every static arm over the given manifests; fixture mode skips the pair-level checks. */
function runStatic(files: readonly string[], fixtureMode: boolean): { readonly arms: readonly ArmResult[]; readonly loads: readonly ManifestLoaded[]; readonly failures: number } {
  /** The TUI plane's sources, read once for the text-scan arms. */
  const tui = tuiSources()
  /** Every package's sources, read once for the bundle-wide `~/.dsh-tui` check. */
  const packages = packageSources()
  /** The readable manifests, kept for the pair and digest arms. */
  const loads: ManifestLoaded[] = []
  /** The arms produced so far. */
  const arms: ArmResult[] = []
  for (const file of files) {
    /** The manifest read under its label. */
    const load = readManifest(file)
    /** The label the arm ids and report use. */
    const label = manifestLabel(file)
    if (!load.ok) {
      arms.push(arm("A.json:" + label, "fail", file + " cannot be read: " + load.message))
      continue
    }
    loads.push(load)
    for (const result of manifestArms(load, tui)) arms.push({ ...result, id: result.id + ":" + label })
  }
  // The COMPAT lane (R6) runs in EVERY static pass, `--static-only` included: the band is a claim this
  // repository publishes, so the gate must redden when its own bytes stop honouring it.
  for (const result of compatArms(loads)) arms.push(result)
  // Repository-wide arms run once, not per manifest.
  arms.push(credentialArm(tui))
  arms.push(stdoutArm(tui))
  arms.push(cellWidthArm(tui))
  arms.push(applyArm())
  arms.push(cleanupArm())
  arms.push(r5RecordArm(R5_DEVIATION.roots))
  arms.push(r5DocArm(R5_DEVIATION.docs))
  arms.push(r5WriteArm(packages))
  arms.push(dResidualArm(readRepoFile("packages/mpd-tui-adapter-plugin/src/index.ts")))
  arms.push(eResidualArm(readRepoFile("evidence/dshgo/tui-admission/2026-11-03T01-23-16Z/requirements-v0.15.json")))
  // F and G have no artifact to re-check: F is the ABSENCE of a claim (no digest exists, so a claim cannot
  // be bound) and G belongs to the ecosystem directory's own display rule. They are stated, never passed.
  arms.push(arm("F.residual", "bound", "no conformance claim is made, so TUI-CLAIM-001 is never exercised; the trusted-in-process disclosure is the host's own /plugin surface (docs §4 F)"))
  arms.push(arm("G.market", "bound", "the market-display rule belongs to the ecosystem directory, not to this repository (docs §4 G)"))
  arms.push(digestArm(loads))
  if (!fixtureMode && loads.length === 2) for (const result of pairArms(loads)) arms.push(result)
  /** The number of red arms, which is the static arm's finding count. */
  const failures = arms.filter((result) => result.status === "fail").length
  return { arms, loads, failures }
}

// ─── HOST ARM ────────────────────────────────────────────────────────────────────────────────────

/** Resolve one executable name on PATH the way the host's own launcher lookup does. */
function onPath(command: string): string | null {
  /** The suffixes the platform's executable resolution tries, in order. */
  const suffixes: readonly string[] = process.platform === "win32" ? [".exe", ".cmd", ".bat", ".com", ""] : [""]
  for (const directory of String(process.env.PATH ?? "").split(delimiter)) {
    if (directory.length === 0) continue
    for (const suffix of suffixes) {
      /** One `dir + name + suffix` candidate, in PATH order. */
      const candidate = join(directory, command + suffix)
      if (existsSync(candidate)) return candidate
    }
  }
  return null
}

/** Why a directory is not a usable installed host, or undefined when it is one. */
function hostDirProblem(dir: string): string | undefined {
  if (!existsSync(dir)) return "directory does not exist"
  /** The candidate package's manifest path. */
  const manifestPath = join(dir, "package.json")
  if (!existsSync(manifestPath)) return "no package.json"
  /** The decoded package manifest, still unknown until the record check below. */
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(manifestPath, "utf8"))
  } catch (error) {
    return "package.json is not readable JSON: " + (error instanceof Error ? error.message : String(error))
  }
  /** The package manifest as a record, when it is one. */
  const record = asRecord(parsed)
  if (record === undefined) return "package.json is not a JSON object"
  /** The package name the host must carry. */
  const name = stringField(record, "name")
  if (name !== HOST_PACKAGE_NAME) return "package name is " + show(name) + ", not " + HOST_PACKAGE_NAME
  if (stringField(record, "version") === undefined) return "package.json carries no version"
  return undefined
}

/** Every discovery probe, in resolution order; the first with no problem is the host. */
function probeHosts(explicitDir: string | undefined): HostProbe[] {
  if (explicitDir !== undefined) {
    /** The single restricted candidate `--host-dir` names. */
    const only = resolve(explicitDir)
    return [{ source: "--host-dir", dir: only, problem: hostDirProblem(only) }]
  }
  /** The probes collected so far, in resolution order. */
  const probes: HostProbe[] = []
  for (const name of ["MPD_DSH_TUI_HOST", "DSH_TUI_ROOT"]) {
    /** The variable's value, when it is a non-empty string. */
    const value = process.env[name]
    if (typeof value === "string" && value.length > 0) {
      /** The directory the variable names. */
      const dir = resolve(value)
      probes.push({ source: "$" + name, dir, problem: hostDirProblem(dir) })
    } else {
      probes.push({ source: "$" + name, dir: undefined, problem: "not set" })
    }
  }
  // Every dsh profile that carries the host, under the configured DSH_HOME and the default one.
  for (const home of [process.env.DSH_HOME, join(homedir(), ".dsh")]) {
    if (typeof home !== "string" || home.length === 0) continue
    /** The profiles directory of this home, when it exists. */
    const profiles = join(home, "profiles")
    if (!existsSync(profiles)) continue
    /** The profile entries, read once. */
    let entries: Dirent[]
    try {
      entries = readdirSync(profiles, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      /** The installed host's directory inside this profile. */
      const dir = join(profiles, entry.name, "node_modules", "@deepseek-harness-tui", "dsh-tui")
      probes.push({ source: "profile " + join(profiles, entry.name), dir, problem: hostDirProblem(dir) })
    }
  }
  // The PATH launcher, whose real path is `<host>/bin/dsh-tui.js`.
  /** The launcher `dsh-tui` on PATH, or null when the host is not installed that way. */
  const bin = onPath("dsh-tui")
  if (bin !== null) {
    try {
      /** The launcher's resolved real path, so a symlinked bin still names its own root. */
      const real = realpathSync(bin)
      /** The host package root the launcher implies. */
      const dir = dirname(dirname(real))
      probes.push({ source: "PATH dsh-tui", dir, problem: hostDirProblem(dir) })
    } catch {
      probes.push({ source: "PATH dsh-tui", dir: undefined, problem: "the launcher's real path cannot be resolved" })
    }
  } else {
    probes.push({ source: "PATH dsh-tui", dir: undefined, problem: "not on PATH" })
  }
  return probes
}

/** Read one exported FUNCTION from a host module, refusing a module that does not carry it. */
function hostFunction<T>(module: Record<string, unknown>, name: string, file: string): T {
  /** The exported value, before its type is checked. */
  const value = module[name]
  if (typeof value !== "function") throw new Error(file + " does not export the function " + name)
  // The installed host ships no type declarations this script can import (and its `exports` map has no
  // `./lib/*` subpath); the caller's generic restates the signature the HOST source declares, and the
  // runtime check above is the gate.
  return value as unknown as T
}

/** Read one exported CONSTANT from a host module, refusing a module that does not carry it. */
function hostConstant<T>(module: Record<string, unknown>, name: string, file: string): T {
  /** The exported value, before its presence is checked. */
  const value = module[name]
  if (value === undefined) throw new Error(file + " does not export " + name)
  // Same reason as `hostFunction`: the caller's generic is the signature, the check above is the gate.
  return value as unknown as T
}

/** Load the installed host's own admission modules by absolute file URL. */
async function loadHostChain(root: string): Promise<{ readonly chain: HostChain; readonly paths: readonly string[] }> {
  /** Every module path this chain needs, with the module that owns it. */
  const paths: string[] = []
  for (const relativePath of Object.values(HOST_MODULES)) {
    /** The absolute module path inside the host payload. */
    const absolute = join(root, relativePath)
    if (!existsSync(absolute)) throw new Error("the host module " + relativePath + " is missing at " + absolute)
    paths.push(absolute)
  }
  /** One host module, imported by absolute file URL (its package `exports` has no `./lib/*` subpath). */
  const load = async (relativePath: string): Promise<Record<string, unknown>> => {
    /** The module's namespace object, narrowed to a record for the checked extractions below. */
    const namespace = asRecord(await import(pathToFileURL(join(root, relativePath)).href))
    if (namespace === undefined) throw new Error("the host module " + relativePath + " did not load as a module namespace")
    return namespace
  }
  /** The vendored manifest parser the host itself loads. */
  const manifestModule = await load(HOST_MODULES.manifest)
  /** The host's own spec-data loader and registry self-checks. */
  const registryModule = await load(HOST_MODULES.registry)
  /** The host's own contract index, validator and negotiation. */
  const admissionModule = await load(HOST_MODULES.admission)
  /** The host's own legacy-descriptor builder. */
  const descriptorModule = await load(HOST_MODULES.descriptor)
  /** The host's own supported-contract coordinates. */
  const constantsModule = await load(HOST_MODULES.constants)
  /** The extracted chain, one checked export at a time. */
  const chain: HostChain = {
    parseManifest: hostFunction(manifestModule, "parseManifest", HOST_MODULES.manifest),
    projectManifest: hostFunction(manifestModule, "projectManifest", HOST_MODULES.manifest),
    loadSpecData: hostFunction(registryModule, "loadSpecData", HOST_MODULES.registry),
    verifyRegistry: hostFunction(registryModule, "verifyRegistry", HOST_MODULES.registry),
    verifyContractProfiles: hostFunction(registryModule, "verifyContractProfiles", HOST_MODULES.registry),
    createContractIndex: hostFunction(admissionModule, "createContractIndex", HOST_MODULES.admission),
    validatePlugin: hostFunction(admissionModule, "validatePlugin", HOST_MODULES.admission),
    negotiate: hostFunction(admissionModule, "negotiate", HOST_MODULES.admission),
    buildLegacyHostDescriptor: hostFunction(descriptorModule, "buildLegacyHostDescriptor", HOST_MODULES.descriptor),
    supportedContracts: hostConstant<readonly unknown[]>(constantsModule, "HOST_SUPPORTED_CONTRACTS", HOST_MODULES.constants),
  }
  return { chain, paths }
}

/** Read the host descriptor's warning list and contract coordinates, tolerating the unknown shape. */
function descriptorFacts(built: unknown): { readonly descriptor: unknown; readonly warnings: readonly string[]; readonly contracts: readonly string[] } {
  /** The builder's result as a record, when it is one. */
  const record = asRecord(built)
  /** The descriptor the builder produced, if any. */
  const descriptor = record === undefined ? undefined : record["descriptor"]
  /** The builder's warnings, as strings. */
  const warnings = (record === undefined ? [] : arrayField(record, "warnings") ?? []).map((value) => String(value))
  /** The descriptor's own contracts, as `apiVersion#kind` coordinates. */
  const contracts: string[] = []
  /** The descriptor record, when the builder produced one. */
  const host = asRecord(descriptor)
  /** The descriptor's contract list, when it carries one. */
  const listed = host === undefined ? undefined : arrayField(host, "contracts")
  for (const value of listed ?? []) {
    /** One descriptor contract as a record. */
    const contract = asRecord(value) ?? {}
    contracts.push(String(contract["apiVersion"] ?? "?") + "#" + String(contract["kind"] ?? "?"))
  }
  return { descriptor, warnings, contracts }
}

/** Run the host arm: discovery, module loading, the profile self-checks and both negotiations. */
async function runHostArm(files: readonly string[], hostDir: string | undefined): Promise<HostArmOutcome> {
  /** Every discovery probe, kept so a failure can name the candidates. */
  const probes = probeHosts(hostDir)
  /** The first probe that is a usable installed host. */
  const selected = probes.find((probe) => probe.problem === undefined && probe.dir !== undefined)
  if (selected === undefined || selected.dir === undefined) {
    say("host arm: no installed " + HOST_PACKAGE_NAME + " host resolved.")
    say("candidates tried:")
    for (const probe of probes) say("  " + probe.source + " = " + (probe.dir ?? "(unset)") + " — " + (probe.problem ?? "ok"))
    say("REMEDY: install the host into a dsh profile with `dsh plugin --profile dsh-tui add " + HOST_PACKAGE_NAME + "`,")
    say("        or set MPD_DSH_TUI_HOST to an installed " + HOST_PACKAGE_NAME + " package root.")
    say("        A skip is NEVER a pass (decision D5): this gate exits non-zero until the host arm runs.")
    return { arms: [arm("H.host", "fail", "no installed host resolved; the candidates and the remedy are printed above"), hostVersionArm(undefined, "no installed host resolved")], host: undefined, notPassed: true }
  }
  /** The resolved host root. */
  const root = selected.dir
  /** The host's own package version, read from the very package.json the probe validated. */
  const version = (() => {
    /** The host package manifest, parsed once. */
    const parsed = asRecord(JSON.parse(readFileSync(join(root, "package.json"), "utf8")))
    return parsed === undefined ? "?" : String(parsed["version"] ?? "?")
  })()
  say("host arm: using " + root + " (" + HOST_PACKAGE_NAME + " " + version + ")")
  // COMPAT (d) is decided the moment the version is known, BEFORE the chain loads: a host outside the
  // published band is a false publication claim however the rest of this arm turns out.
  /** COMPAT (d) against the version this discovery actually measured. */
  const compat = hostVersionArm(version, "the installed host was discovered at " + root)
  /** The host's own admission entry points. */
  let chain: HostChain
  try {
    /** The loaded chain plus the module paths it came from. */
    const loaded = await loadHostChain(root)
    chain = loaded.chain
    say("host modules: " + loaded.paths.map((path) => relative(root, path)).join(", "))
  } catch (error) {
    return { arms: [arm("H.host", "fail", error instanceof Error ? error.message : String(error)), compat], host: undefined, notPassed: false }
  }

  /** The arms produced by the host chain. */
  const arms: ArmResult[] = [arm("H.host", "pass", "the installed host " + HOST_PACKAGE_NAME + " " + version + " resolved at " + root), compat]
  /** The spec-data bundle the host itself loads. */
  let data: Record<string, unknown>
  try {
    /** The host's own spec-data loader result, before it is narrowed. */
    const loaded = chain.loadSpecData()
    /** The loaded bundle as a record, when the host resolved one. */
    const record = asRecord(loaded)
    if (record === undefined) throw new Error("loadSpecData() returned undefined: the host carries no spec-data registry")
    data = record
    /** The host's own registry self-check violations. */
    const registryViolations = chain.verifyRegistry(loaded)
    /** The host's own contract-profile self-check violations. */
    const profileViolations = chain.verifyContractProfiles(loaded)
    if (registryViolations.length > 0 || profileViolations.length > 0) {
      throw new Error("the host's own spec-data self-check failed: " + [...registryViolations, ...profileViolations].map((value) => String(value)).join(" | "))
    }
    arms.push(arm("H.spec-data", "pass", "loadSpecData() + verifyRegistry() + verifyContractProfiles() resolved " + String(data["dir"] ?? "?")))
  } catch (error) {
    arms.push(arm("H.spec-data", "fail", error instanceof Error ? error.message : String(error)))
    return { arms, host: undefined, notPassed: false }
  }

  /** The contract index every host check runs against. */
  let index: unknown
  /** The legacy-compatibility descriptor the host itself builds for its mounted topology. */
  let descriptor: unknown
  /** The descriptor builder's own warnings, recorded in the report. */
  let warnings: readonly string[] = []
  /** The coordinates the descriptor advertised. */
  let contracts: readonly string[] = []
  try {
    index = chain.createContractIndex(data["registry"], data["permissions"])
    /** The descriptor build result, as the host's own builder returned it. */
    const built = chain.buildLegacyHostDescriptor({ generationId: "verify-tui-admission", headless: false, supported: chain.supportedContracts, decisionFeatures: [] })
    /** The descriptor and its facts, read tolerantly. */
    const facts = descriptorFacts(built)
    descriptor = facts.descriptor
    warnings = facts.warnings
    contracts = facts.contracts
    if (descriptor === undefined) throw new Error("buildLegacyHostDescriptor() produced no descriptor")
    arms.push(arm("H.descriptor", "pass", "the host's own legacy descriptor advertises " + String(contracts.length) + " contract(s): " + contracts.join(", ")))
  } catch (error) {
    arms.push(arm("H.descriptor", "fail", error instanceof Error ? error.message : String(error)))
    return { arms, host: undefined, notPassed: false }
  }

  /** One decision per manifest, recorded beside the arms. */
  const decisions: { manifest: string; decision: string; reasonCode: string | undefined }[] = []
  for (const file of files) {
    /** The manifest read as bytes, so the host parses exactly what the static arm judged. */
    const load = readManifest(file)
    if (!load.ok) {
      arms.push(arm("H.chain:" + manifestLabel(file), "fail", load.message))
      continue
    }
    try {
      // THE HOST'S OWN PARSER, never this gate's JSON.parse: the parsed object below is the value the
      // host's validator and negotiator consume, and the id it reports is checked against the bytes.
      /** The host's own parse of the manifest bytes. */
      const manifest = chain.parseManifest(load.text, { source: load.absolute })
      /** The host's parsed manifest as a record, to compare its id with the document's. */
      const parsed = asRecord(manifest)
      /** The id the host parser reported. */
      const parsedId = parsed === undefined ? undefined : stringField(parsed, "id")
      /** The id the raw document declares. */
      const declaredId = stringField(load.doc, "id")
      if (parsedId !== declaredId) throw new Error("the host parser reported id " + show(parsedId) + " where the bytes declare " + show(declaredId))
      chain.validatePlugin(index, manifest)
      chain.projectManifest(manifest)
      /** The host's own five-state decision. */
      const decision = asRecord(chain.negotiate(index, manifest, descriptor, []))
      /** The decision word, when the host answered one. */
      const word = decision === undefined ? undefined : stringField(decision, "decision")
      /** The reason code a non-compatible answer carries. */
      const reasonCode = decision === undefined ? undefined : stringField(decision, "reasonCode")
      decisions.push({ manifest: file, decision: word ?? "?", reasonCode })
      if (word === "compatible") {
        arms.push(arm("H.chain:" + manifestLabel(file), "pass", "the host parsed, validated and negotiated " + file + " to `compatible`"))
      } else {
        arms.push(arm("H.chain:" + manifestLabel(file), "fail", "the host answered " + show(word) + (reasonCode === undefined ? "" : " (" + reasonCode + ")") + " for " + file + "; A6 requires compatible"))
      }
    } catch (error) {
      arms.push(arm("H.chain:" + manifestLabel(file), "fail", file + ": " + (error instanceof Error ? error.message : String(error))))
    }
  }
  /** The host measurement the evidence file records. */
  const host: HostReport = {
    root,
    version,
    specDir: String(data["dir"] ?? "?"),
    contracts,
    warnings,
    decisions,
  }
  return { arms, host, notPassed: false }
}

// ─── REPORT ──────────────────────────────────────────────────────────────────────────────────────

/** Render one arm as a report line: the label spells the status out, never a bare code. */
function reportArm(result: ArmResult): void {
  /** The human label for this arm's status. */
  const label = result.status === "pass" ? "PASS" : result.status === "fail" ? "FAIL" : result.status === "bound" ? "BOUND" : "ALLOWED-DEVIATION"
  say("arm " + result.id + " " + label + " — " + result.detail)
}

/** Print the run's findings and its summary line, and return the finding count. */
function summarize(arms: readonly ArmResult[]): number {
  /** Every red arm, printed again so a long transcript's failures are impossible to miss. */
  const red = arms.filter((result) => result.status === "fail")
  for (const result of red) say("FINDING " + result.id + ": " + result.detail)
  /** How many arms passed. */
  const passed = arms.filter((result) => result.status === "pass").length
  /** How many arms are declared bounds. */
  const bounds = arms.filter((result) => result.status === "bound").length
  /** How many arms are the named deviation. */
  const deviations = arms.filter((result) => result.status === "deviation").length
  if (red.length === 0) {
    say("REPORT: PASS — " + String(passed) + " arms passed, " + String(deviations) + " allowed deviation(s), " + String(bounds) + " bound(s).")
    say("BOUND: static admission + the host's own negotiation only — NOT a live TTY mount, and NOT a Verified claim (no artifact digest exists).")
    return 0
  }
  say("REPORT: FAIL — " + String(red.length) + " finding(s) across " + String(arms.length) + " arms; " + String(passed) + " passed.")
  return red.length
}

/** Write the full arm record, creating the output directory when it does not exist. */
function writeRecord(file: string, payload: unknown): void {
  /** The absolute output path. */
  const absolute = resolve(REPO, file)
  mkdirSync(dirname(absolute), { recursive: true })
  writeFileSync(absolute, JSON.stringify(payload, null, 2) + "\n")
}

// ─── CLI ────────────────────────────────────────────────────────────────────────────────────────

/** Parse argv; a usage problem throws, and main turns it into exit 2 with the usage text. */
function parseCli(argv: readonly string[]): CliOptions {
  /** True when `--self-test` was requested. */
  let selfTest = false
  /** True when `--static-only` was requested. */
  let staticOnly = false
  /** True when `--help` was requested. */
  let help = false
  /** Every `--manifest` path, in order. */
  const manifests: string[] = []
  /** The `--host-dir` value, when one was given. */
  let hostDir: string | undefined
  /** The `--json` value, when one was given. */
  let jsonOut: string | undefined
  for (let index = 0; index < argv.length; index++) {
    /** The argv entry under inspection. */
    const arg = argv[index]
    if (arg === "--self-test") {
      selfTest = true
      continue
    }
    if (arg === "--static-only") {
      staticOnly = true
      continue
    }
    if (arg === "--help" || arg === "-h") {
      help = true
      continue
    }
    if (arg === "--manifest") {
      /** The path this flag names. */
      const value = argv[++index]
      if (value === undefined) throw new Error("--manifest needs a path")
      manifests.push(value)
      continue
    }
    if (arg === "--host-dir") {
      /** The directory this flag names. */
      const value = argv[++index]
      if (value === undefined) throw new Error("--host-dir needs a directory")
      hostDir = value
      continue
    }
    if (arg === "--json") {
      /** The output path this flag names. */
      const value = argv[++index]
      if (value === undefined) throw new Error("--json needs a path")
      jsonOut = value
      continue
    }
    throw new Error("unknown argument: " + arg)
  }
  return { selfTest, staticOnly, help, manifests, hostDir, jsonOut }
}

/** The usage text: every mode, the exit codes and the two bounds a caller must not misread. */
function usage(): readonly string[] {
  return [
    "usage: node scripts/verify-tui-admission.ts [options]",
    "  (no options)                  the gate: static arms + the installed host's own admission chain",
    "  --self-test                   host-free fixture arms, including a NEGATIVE control that must redden",
    "  --manifest <path>             fixture mode: static arms on that manifest only (repeatable)",
    "  --static-only                 static arms only; exits 3 because a skip is never a pass (D5)",
    "  --host-dir <dir>              restrict host discovery to one candidate (test seam)",
    "  --json <path>                 also write the full arm record",
    "  --help                        this text",
    "exit codes: 0 green · 1 finding · 2 usage/config · 3 host arm not run",
    "bounds: static admission + the host's own negotiation, never a live TTY mount, never a Verified claim",
  ]
}

// ─── GATE ───────────────────────────────────────────────────────────────────────────────────────

/** Run the gate itself and return its exit code. */
async function runGate(cli: CliOptions): Promise<number> {
  /** True when `--manifest` selected fixture mode, which never runs the host arm. */
  const fixtureMode = cli.manifests.length > 0
  /** The manifests this run judges. */
  const files = fixtureMode ? cli.manifests : DEFAULT_MANIFESTS
  say("mode: " + (fixtureMode ? "fixture (static arms only)" : "gate (static + host)"))
  for (const file of files) say("manifest: " + file)
  /** The static arm's outcome. */
  const stat = runStatic(files, fixtureMode)
  for (const result of stat.arms) reportArm(result)
  if (fixtureMode) {
    // COMPAT (d) needs a DISCOVERED host, and this mode discovers none: the arm REPORTS that instead of
    // vanishing from the report, because a sub-assertion no mode states is a silent pass.
    /** COMPAT (d), reported as not checked in fixture mode. */
    const unchecked = hostVersionArm(undefined, "fixture mode (--manifest) did not run host discovery")
    reportArm(unchecked)
    /** Every arm this mode ran: the static ones plus the COMPAT (d) report. */
    const arms = [...stat.arms, unchecked]
    say("FIXTURE MODE: the host arm is not part of this mode; only the static arms above ran.")
    /** The finding count of the static arms alone. */
    const failures = summarize(arms)
    if (cli.jsonOut !== undefined) writeRecord(cli.jsonOut, { tool: "verify-tui-admission", mode: "fixture", files, arms, failures })
    return failures === 0 ? EXIT.GREEN : EXIT.FINDINGS
  }
  if (cli.staticOnly) {
    // Same rule as the fixture branch: `--static-only` is exactly the mode that must SAY the discovered
    // host was never compared, so the band's host half is a declared bound rather than an implied pass.
    /** COMPAT (d), reported as not checked under `--static-only`. */
    const unchecked = hostVersionArm(undefined, "--static-only did not run host discovery")
    reportArm(unchecked)
    /** Every arm this mode ran: the static ones plus the COMPAT (d) report. */
    const arms = [...stat.arms, unchecked]
    say("NOT PASSED: --static-only was requested, so the host arm did NOT run. A skip is never a pass (D5);")
    say("            run without --static-only for an admission verdict.")
    /** The finding count of the static arms alone. */
    const failures = summarize(arms)
    if (cli.jsonOut !== undefined) writeRecord(cli.jsonOut, { tool: "verify-tui-admission", mode: "static-only", files, arms, failures, verdict: "not-passed" })
    return failures === 0 ? EXIT.NOT_PASSED : EXIT.FINDINGS
  }
  /** The host arm's outcome. */
  const hostResult = await runHostArm(files, cli.hostDir)
  say("")
  for (const result of hostResult.arms) reportArm(result)
  /** Every arm of the full run. */
  const arms = [...stat.arms, ...hostResult.arms]
  // A missing host is NOT a finding against the tree: it is a HOST ARM THAT DID NOT RUN, and decision
  // D5 makes that exit non-zero (3) instead of degrading into a green "skip". Static findings are still
  // printed so a red tree is never hidden behind the missing-host state.
  if (hostResult.notPassed) {
    for (const result of stat.arms.filter((entry) => entry.status === "fail")) say("FINDING " + result.id + ": " + result.detail)
    say("REPORT: NOT PASSED — the host arm did NOT run (no installed host); " + String(stat.failures) + " static finding(s). Nothing in this run is an admission verdict (decision D5).")
    if (cli.jsonOut !== undefined) writeRecord(cli.jsonOut, { tool: "verify-tui-admission", mode: "gate", files, arms, failures: stat.failures, host: hostResult.host, deviations: [R5_DEVIATION], verdict: "not-passed" })
    return EXIT.NOT_PASSED
  }
  /** The full run's finding count, and the return code. */
  const failures = summarize(arms)
  if (cli.jsonOut !== undefined) {
    writeRecord(cli.jsonOut, {
      tool: "verify-tui-admission",
      mode: "gate",
      files,
      arms,
      failures,
      host: hostResult.host,
      deviations: [R5_DEVIATION],
      verdict: failures === 0 ? "pass" : "fail",
    })
  }
  return failures === 0 ? EXIT.GREEN : EXIT.FINDINGS
}

// ─── SELF-TEST ──────────────────────────────────────────────────────────────────────────────────

/** Build the deliberately broken fixture the negative control spawns: every rule broken on purpose. */
function brokenFixture(): Record<string, unknown> {
  /** The shipped bundle manifest, the realistic base the fixture mutates. */
  const base = readManifest(DEFAULT_MANIFESTS[0] ?? "dsh-plugin.json")
  /** The clone the fixture mutates; a real manifest keeps the fixture honest about the rest of the shape. */
  const fixture: Record<string, unknown> = base.ok ? (JSON.parse(base.text) as Record<string, unknown>) : {}
  fixture["$schema"] = "schemas/dsh-plugin-0.15.json"
  fixture["manifestVersion"] = "0.14"
  fixture["id"] = ""
  fixture["facets"] = { host: { entry: "missing.js" }, client: { entry: "client.js" } }
  fixture["requires"] = { contracts: [{ apiVersion: "tui.dsh/v1alpha1", kind: "DecisionEvents", optional: true }] }
  fixture["permissions"] = [{ name: "mpd.not.used", scope: "tui/nowhere" }]
  fixture["contributes"] = { commands: "none" }
  fixture["provides"] = { services: [] }
  return fixture
}

/** Spawn this script as a child and capture its transcript and exit code. */
function spawnGate(args: readonly string[]): { readonly status: number | null; readonly output: string } {
  /** The child process's captured result. */
  const result = spawnSync(process.execPath, [SELF, ...args], { cwd: REPO, encoding: "utf8" })
  return { status: result.status, output: captured(result.stdout) + captured(result.stderr) }
}

/** Run every host-free self-test arm, print each one's outcome, then the census line. */
function selfTest(): void {
  /** Every arm's recorded outcome. */
  const arms: SelfTestArm[] = []
  /** Record one arm and print its line. */
  const check = (name: string, ok: boolean, note: string): void => {
    arms.push({ name, ok, note })
    say("self-test arm " + name + ": " + (ok ? "PASS" : "FAIL") + " — " + note)
  }
  /** The temporary directory the fixture arms use; removed in the finally block below. */
  const dir = mkdtempSync(join(tmpdir(), "tui-admission-selftest-"))
  try {
    // 1 · The shipped tree passes its own static arms (host-free: no host is touched here).
    /** The shipped manifests' static outcome, produced in-process. */
    const shipped = runStatic(DEFAULT_MANIFESTS, false)
    check("shipped-static", shipped.failures === 0, shipped.failures === 0 ? "the two shipped manifests and the repository pass every static arm" : "the shipped tree already reddens: " + shipped.arms.filter((result) => result.status === "fail").map((result) => result.id).join(", "))

    // 2 · NEGATIVE CONTROL: a deliberately broken manifest MUST make the child exit non-zero and
    // print its rules red. The child is a REAL spawn of this script in fixture mode, so the control
    // travels the same code path a user's run does.
    /** The broken fixture's path. */
    const brokenPath = join(dir, "broken-dsh-plugin.json")
    writeFileSync(brokenPath, JSON.stringify(brokenFixture(), null, 2) + "\n")
    /** The negative control's child run. */
    const negative = spawnGate(["--manifest", brokenPath])
    /** The red rule ids the broken fixture must trip. */
    const expectedRed = ["A.schema", "A.manifest-version", "A.id", "A.host-facet", "A.host-entry", "A.facets", "B.contracts", "B.no-provides", "B.permissions", "B.commands"]
    /** The expected red ids the transcript actually carries. */
    const observedRed = expectedRed.filter((id) => negative.output.includes("arm " + id + ":fixture FAIL"))
    check(
      "negative-control",
      negative.status === EXIT.FINDINGS && observedRed.length === expectedRed.length && negative.output.includes("REPORT: FAIL"),
      "a deliberately broken fixture exited " + String(negative.status) + " with " + String(observedRed.length) + "/" + String(expectedRed.length) + " expected red arms" + (observedRed.length === expectedRed.length ? "" : " (missing: " + expectedRed.filter((id) => !observedRed.includes(id)).join(", ") + ")"),
    )
    // The control transcript is ECHOED so the report itself shows the red arm, not just a summary.
    for (const line of negative.output.split("\n")) {
      if (line.includes(" FAIL ") || line.includes("REPORT: FAIL") || line.includes("FINDING ")) say("self-test control transcript: " + line.trim())
    }

    // 3 · POSITIVE CONTROL: the SAME spawn path, fed the shipped manifest, exits 0. Without this the
    // negative control could be red for a reason unrelated to the fixture (a crash, a typo, a missing
    // rule id), which is exactly the vacuous-failure trap.
    /** The positive control's child run. */
    const positive = spawnGate(["--manifest", DEFAULT_MANIFESTS[0] ?? "dsh-plugin.json"])
    check("positive-control", positive.status === EXIT.GREEN && positive.output.includes("REPORT: PASS"), "the same spawn path on the shipped manifest exited " + String(positive.status) + " with REPORT: PASS")

    // 4 · NO HOST IS NOT A PASS (D5). `--host-dir` restricts discovery to one absent candidate, so the
    // arm is deterministic on a machine WITH a host.
    /** The absent host directory the no-host arm names. */
    const absentHost = join(dir, "no-such-host")
    /** The no-host child run. */
    const noHost = spawnGate(["--host-dir", absentHost])
    check(
      "no-host-not-a-pass",
      noHost.status === EXIT.NOT_PASSED && noHost.output.includes("candidates tried") && noHost.output.includes("REMEDY") && noHost.output.includes(absentHost),
      "an absent host exited " + String(noHost.status) + " and printed the candidate list plus the remedy",
    )

    // 5 · The R5 record is FALSIFIABLE: a bogus record must redden, so the allowance is not a rubber stamp.
    /** The R5 record arm fed one record that cannot hold. */
    const bogusR5 = r5RecordArm([{ root: "~/.mpd/nowhere", evidenceFile: "packages/does-not-exist/src/index.ts", patterns: ["never-written"] }])
    check("r5-record-falsifiable", bogusR5.status === "fail", "a bogus R5 record reddened: " + bogusR5.detail)

    // 6 · The `~/.dsh-tui` write check is FALSIFIABLE: a synthetic write must redden it.
    /** The write arm fed one synthetic line that pairs the path with mkdirSync. */
    const writeHit = r5WriteArm([{ file: "packages/x/src/bad.ts", text: 'mkdirSync(join(home, ".dsh-tui"))' }])
    check("r5-write-falsifiable", writeHit.status === "fail", "a synthetic write under ~/.dsh-tui reddened: " + writeHit.detail)

    // 7 · The credential and stdout scans are FALSIFIABLE.
    /** The credential arm fed one synthetic apiKey reference. */
    const credentialHit = credentialArm([{ file: "packages/x/src/bad.ts", text: "const apiKey = process.env.X" }])
    check("credential-falsifiable", credentialHit.status === "fail", "a synthetic apiKey reference reddened")
    /** The stdout arm fed one synthetic console.log call. */
    const stdoutHit = stdoutArm([{ file: "packages/x/src/bad.ts", text: 'console.log("diagnostic")' }])
    check("stdout-falsifiable", stdoutHit.status === "fail", "a synthetic console.log reddened")

    // 8 · The optional-fallback rule is FALSIFIABLE at the pure-function level.
    /** The contract finding for an optional contract with no fallback. */
    const fallbackFinding = contractFinding({ apiVersion: "tui.dsh/v1alpha1", kind: "DecisionEvents", optional: true })
    check("fallback-required", fallbackFinding !== undefined, "an optional contract without a written fallback is refused: " + String(fallbackFinding))

    // 9 · The D and E residual bounds are FALSIFIABLE: a fixed `effectOn`, or a matrix that gains the
    // TUI-OBS-002 row, must redden instead of leaving a stale "PARTIAL" record in place.
    /** The D residual check fed a fixed effectOn whose catch rethrows. */
    const dFixed = dResidualArm('export function effectOn() { try { run() } catch { throw new Error("x") } }')
    check("d-residual-falsifiable", dFixed.status === "fail", "a fixed effectOn reddened the D residual record")
    /** The E residual check fed a matrix that carries the row. */
    const eFixed = eResidualArm('{"requirements":[{"id":"TUI-OBS-002"}]}')
    check("e-residual-falsifiable", eFixed.status === "fail", "a matrix carrying TUI-OBS-002 reddened the E residual record")

    // 10 · The digest bound is FALSIFIABLE: a manifest that starts carrying a digest reddens it.
    /** The digest arm fed a manifest carrying a digest key. */
    const digestHit = digestArm([{ ok: true, file: "fixture", absolute: join(dir, "fixture.json"), text: "{}", doc: { digest: "sha256:deadbeef" } }])
    check("digest-bound-falsifiable", digestHit.status === "fail", "a manifest carrying a digest reddened the no-Verified-claim bound")

    // 11 · THE COMPAT LANE (R6) IS FALSIFIABLE — one negative control per sub-assertion, because a band
    // no gate can break is exactly the defect this lane exists to close. Each fixture is a REAL spawn of
    // this script, so every control travels the code path a user's run does.
    /** The shipped bundle manifest the band fixtures derive from. */
    const baseManifest = readManifest(DEFAULT_MANIFESTS[0] ?? "dsh-plugin.json")
    /** The shipped bundle document; an unreadable base would make every control below vacuous. */
    const baseDoc = baseManifest.ok ? (JSON.parse(baseManifest.text) as Record<string, unknown>) : {}
    /** Write one band fixture and return its path. */
    const bandFixture = (name: string, hosts: readonly string[]): string => {
      /** The fixture document, cloned so one control cannot mutate another's input. */
      const doc = JSON.parse(JSON.stringify(baseDoc)) as Record<string, unknown>
      doc["compat"] = { hosts }
      /** The fixture's path inside the self-test's temporary directory. */
      const file = join(dir, name)
      writeFileSync(file, JSON.stringify(doc, null, 2) + "\n")
      return file
    }
    // (a) an EMPTY band must redden.
    /** The empty-band fixture's path. */
    const emptyBand = bandFixture("band-empty.json", [])
    /** The empty-band child run. */
    const emptyBandRun = spawnGate(["--manifest", emptyBand])
    check("compat-empty-band", emptyBandRun.status === EXIT.FINDINGS && emptyBandRun.output.includes("arm COMPAT.band:fixture FAIL"), "an EMPTY compat.hosts exited " + String(emptyBandRun.status) + " with COMPAT.band red")
    // (b) two manifests whose bands DISAGREE must redden.
    /** The narrower band's fixture path — one member of the shipped band. */
    const narrowBand = bandFixture("band-narrow.json", ["@deepseek-harness-tui/dsh-tui@0.19.0"])
    /** The wider band's fixture path — the shipped band, so only the comparison itself can be red. */
    const wideBand = bandFixture("band-wide.json", ["@deepseek-harness-tui/dsh-tui@0.18.0", "@deepseek-harness-tui/dsh-tui@0.19.0"])
    /** The band-drift child run. */
    const driftRun = spawnGate(["--manifest", narrowBand, "--manifest", wideBand])
    check("compat-band-parity", driftRun.status === EXIT.FINDINGS && driftRun.output.includes("arm COMPAT.band-parity FAIL"), "two manifests whose bands disagree exited " + String(driftRun.status) + " with COMPAT.band-parity red")
    // (c) a band that omits the DISTRIBUTION ref must redden.
    /** The band that drops the distribution's own host coordinate. */
    const staleBand = bandFixture("band-stale.json", ["@deepseek-harness-tui/dsh-tui@0.18.0"])
    /** The distribution-ref child run. */
    const staleRun = spawnGate(["--manifest", staleBand])
    check("compat-distribution-ref", staleRun.status === EXIT.FINDINGS && staleRun.output.includes("arm COMPAT.distribution-ref FAIL"), "a band missing the distribution ref exited " + String(staleRun.status) + " with COMPAT.distribution-ref red")
    // (d) a DISCOVERED host whose version is outside the band must redden. The discovery is the script's
    // own (`--host-dir` is its documented test seam); only the package.json is synthetic.
    /** The fake installed host's root. */
    const oldHost = join(dir, "old-host")
    mkdirSync(oldHost, { recursive: true })
    writeFileSync(join(oldHost, "package.json"), JSON.stringify({ name: HOST_PACKAGE_NAME, version: "0.17.0" }, null, 2) + "\n")
    /** The out-of-band host child run. */
    const oldHostRun = spawnGate(["--host-dir", oldHost])
    check("compat-host-version", oldHostRun.status === EXIT.FINDINGS && oldHostRun.output.includes("arm COMPAT.host-version FAIL"), "a discovered host at 0.17.0 exited " + String(oldHostRun.status) + " with COMPAT.host-version red")
    // … and when NO host is discovered the same sub-assertion is REPORTED, never silently passed.
    /** The static-only child run, which discovers no host by construction. */
    const noDiscovery = spawnGate(["--static-only"])
    check("compat-host-version-reported", noDiscovery.status === EXIT.NOT_PASSED && noDiscovery.output.includes("arm COMPAT.host-version BOUND") && noDiscovery.output.includes("NOT CHECKED"), "--static-only exited " + String(noDiscovery.status) + " and reported COMPAT.host-version as NOT CHECKED")

    // 12 · The CLI contract: an unknown flag is exit 2, `--help` is exit 0.
    /** The unknown-flag child run. */
    const usageError = spawnGate(["--not-a-flag"])
    /** The help child run. */
    const helpRun = spawnGate(["--help"])
    check("cli-contract", usageError.status === EXIT.CONFIG && helpRun.status === EXIT.GREEN, "an unknown flag exited " + String(usageError.status) + " and --help exited " + String(helpRun.status))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
  /** The census: passed arms against the total, matching the repository's self-test grammar. */
  const failed = arms.filter((result) => !result.ok).length
  say("self-test " + (failed === 0 ? "PASS" : "FAIL") + ": " + String(arms.length - failed) + "/" + String(arms.length) + " arms")
  if (failed > 0) for (const result of arms.filter((entry) => !entry.ok)) say("self-test FINDING " + result.name + ": " + result.note)
  process.exitCode = failed === 0 ? EXIT.GREEN : EXIT.FINDINGS
}

// ─── MAIN ───────────────────────────────────────────────────────────────────────────────────────

/** Dispatch the requested mode, mapping a usage error to exit 2 with the usage text. */
async function main(): Promise<void> {
  /** The parsed command line, assigned before any mode reads it. */
  let cli: CliOptions
  try {
    cli = parseCli(process.argv.slice(2))
  } catch (error) {
    say("usage error: " + (error instanceof Error ? error.message : String(error)))
    for (const line of usage()) say(line)
    process.exitCode = EXIT.CONFIG
    return
  }
  if (cli.help) {
    for (const line of usage()) say(line)
    return
  }
  if (cli.selfTest) {
    selfTest()
    return
  }
  process.exitCode = await runGate(cli)
}

await main()
