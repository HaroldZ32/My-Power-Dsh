#!/usr/bin/env node
// The plugin-manifest gate: the TWO hard rules this bundle must never break, plus the packaging
// facts that make `dsh plugin --profile <p> add <spec>` work for a person who never clones the
// repository.
//
// WHY THIS FILE EXISTS (user requirement, standing): a bundle the profile installs is a package
// whose manifest is EXECUTED BY THE PACKAGE MANAGER before any plugin code runs. Two properties are
// therefore not style questions but install-time correctness:
//
//   1. `cordis` must not appear in `dependencies`, `peerDependencies` or `optionalDependencies`.
//      The Harness supplies cordis to every plugin row it loads; a package that declares its own
//      copy fights the host's instance (two `Context` realms, services invisible across them).
//      The refusal is BY NAME and it is not softened by the optional field: an optional cordis
//      dependency is still a dependency pnpm may install.
//   2. `preinstall` / `install` / `postinstall` / `prepare` must not appear as script names.
//      Those four run arbitrary code on the installing machine. This bundle ships its built
//      `dist/` entries, so it needs none of them, and a reviewer's one-command install must not
//      execute a build.
//
// The gate also asserts the packaging contract that makes the one-command install behave like the
// installed bundles beside it: the declared patch files exist, every module path a row names
// resolves inside the package, the `files` allowlist admits every path the runtime needs (and
// excludes the frozen `evidence/` tree), and the display metadata the plugin inventory reads is
// present.
//
// Modes:
//   node scripts/verify-plugin-manifest.ts                 scan this repository's manifest
//   node scripts/verify-plugin-manifest.ts --self-test     fixture-driven negative controls
//   node scripts/verify-plugin-manifest.ts --out <dir>     also write <dir>/result.json + output.log
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

/** Repository root, derived from this script's own location (`<root>/scripts/`). */
const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))

/** A dependency field that must never declare a cordis package. */
const CORDIS_FORBIDDEN_FIELDS = ["dependencies", "peerDependencies", "optionalDependencies"] as const

/** A dependency field reported (but not fatal) when it declares cordis. */
const CORDIS_REPORTED_FIELDS = ["devDependencies"] as const

/** Script names refused by the install-time rule (substring match on the script key). */
const LIFECYCLE_KEYWORDS = ["preinstall", "install", "postinstall", "prepare"] as const

/** Package names refused by the cordis rule (exact name, or the scope's whole namespace). */
const CORDIS_NAMES = ["cordis", "@cordis"] as const

/** One violation: where it was found, what rule it broke, and what to do about it. */
interface Violation {
  /** Repository-relative file the violation was read from. */
  readonly file: string
  /** Rule identifier: `cordis-dependency`, `lifecycle-script`, `packaging`. */
  readonly rule: string
  /** One-line human description. */
  readonly detail: string
}

/** One check's outcome, so a passing check is still visible in the record. */
interface CheckResult {
  /** Stable check id. */
  readonly id: string
  /** Whether the check passed. */
  readonly ok: boolean
  /** What was observed, phrased so a reader needs no other context. */
  readonly detail: string
}

/** Parse a JSON file, returning undefined instead of throwing so a caller can report the path. */
function readJsonFile(file: string): Record<string, unknown> | undefined {
  try {
/** The parsed document, narrowed to an object below. */
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"))
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined
  } catch {
    return undefined
  }
}

/** Whether a dependency name is the cordis package or one of its scoped names. */
function isCordisName(name: string): boolean {
  return CORDIS_NAMES.some((refused) => name === refused || name.startsWith(`${refused}/`))
}

/** Whether a script key carries one of the four refused lifecycle keywords. */
function lifecycleKeywordOf(key: string): string | undefined {
/** The script key lower-cased, so the keyword match does not depend on how it was typed. */
  const lower = key.toLowerCase()
  return LIFECYCLE_KEYWORDS.find((keyword) => lower.includes(keyword))
}

/** Every dependency field of a manifest, as name → field, for the cordis rule. */
function dependencyEntries(manifest: Record<string, unknown>, fields: readonly string[]): Array<{ name: string; field: string }> {
/** Accumulated name/field pairs across the requested dependency fields. */
  const entries: Array<{ name: string; field: string }> = []
  for (const field of fields) {
/** The raw value of one dependency field, read defensively. */
    const value = manifest[field]
    if (typeof value !== "object" || value === null || Array.isArray(value)) continue
    for (const name of Object.keys(value)) entries.push({ name, field })
  }
  return entries
}

/** Check the two hard install-time rules against one manifest. */
function checkHardRules(manifest: Record<string, unknown>, file: string, violations: Violation[]): CheckResult[] {
/** One result per install-time rule, so a passing rule is still visible in the record. */
  const results: CheckResult[] = []
/** Every declared name across the fields the cordis rule refuses. */
  const declared = dependencyEntries(manifest, CORDIS_FORBIDDEN_FIELDS)
/** The subset of those names the cordis rule refuses. */
  const cordisDeclared = declared.filter((entry) => isCordisName(entry.name))
  for (const entry of cordisDeclared) {
    violations.push({
      file,
      rule: "cordis-dependency",
      detail: `${entry.field} declares ${entry.name}; cordis is supplied by the Harness and must never be declared (the optional field is not an exemption)`,
    })
  }
  results.push({
    id: "cordis-dependency",
    ok: cordisDeclared.length === 0,
    detail: cordisDeclared.length === 0
      ? `${declared.length} declared dependency name(s) across ${CORDIS_FORBIDDEN_FIELDS.join("/")}, none of them cordis`
      : `${cordisDeclared.length} cordis declaration(s): ${cordisDeclared.map((entry) => `${entry.field}:${entry.name}`).join(", ")}`,
  })

/** devDependency declarations of cordis: reported, never fatal, so the exception stays deliberate. */
  const reported = dependencyEntries(manifest, CORDIS_REPORTED_FIELDS).filter((entry) => isCordisName(entry.name))
  results.push({
    id: "cordis-devDependency-note",
    ok: true,
    detail: reported.length === 0
      ? "devDependencies declare no cordis package"
      : `NOTE (not a failure): devDependencies declare ${reported.map((entry) => entry.name).join(", ")} — a dev-only type shim never reaches a profile install, but it is named here so the exception is deliberate`,
  })

/** The manifest's script map, or an empty map when it declares none. */
  const scripts = typeof manifest.scripts === "object" && manifest.scripts !== null && !Array.isArray(manifest.scripts)
    ? (manifest.scripts as Record<string, unknown>)
    : {}
/** Script names carrying one of the refused lifecycle keywords. */
  const offenders = Object.keys(scripts)
    .map((key) => ({ key, keyword: lifecycleKeywordOf(key) }))
    .filter((entry): entry is { key: string; keyword: string } => entry.keyword !== undefined)
  for (const offender of offenders) {
    violations.push({
      file,
      rule: "lifecycle-script",
      detail: `scripts.${offender.key} carries the refused keyword "${offender.keyword}"; the package manager would run it on the installing machine`,
    })
  }
  results.push({
    id: "lifecycle-script",
    ok: offenders.length === 0,
    detail: offenders.length === 0
      ? `${Object.keys(scripts).length} script name(s), none carrying ${LIFECYCLE_KEYWORDS.join("/")}`
      : `${offenders.length} refused script name(s): ${offenders.map((entry) => entry.key).join(", ")}`,
  })
  return results
}

/** Extract every `@mpd-dsh/mpd/<path>` module path a patch document names. */
function modulePathsInPatch(text: string): string[] {
/** Module paths collected from the patch text and deduplicated. */
  const found = new Set<string>()
/** Matches any `@mpd-dsh/mpd/<path>` module reference a row may name. */
  const pattern = /@mpd-dsh\/mpd\/([A-Za-z0-9._/@-]+?\.(?:ts|js|mjs|cjs|yml|yaml|json))/g
  for (const match of text.matchAll(pattern)) {
/** The captured module path, without the package prefix. */
    const path = match[1]
    if (path !== undefined && !path.startsWith("node_modules/")) found.add(path)
  }
  return [...found].sort()
}

/** The `files` allowlist of a package, as a list of patterns (empty when absent). */
function filesAllowlist(manifest: Record<string, unknown>): string[] {
/** The manifest's `files` value, when it is a list. */
  const value = manifest.files
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : []
}

/**
 * Compile one `files` pattern into an anchored regular expression with npm's glob semantics:
 * `**` spans path separators, `*` and `?` do not, and a bare directory name admits the whole
 * subtree (which is how `files: ["lib"]` is read by npm-packlist).
 * @param pattern - one allowlist pattern, without its leading `!`.
 * @returns the anchored matcher for that pattern.
 */
function globMatcher(pattern: string): RegExp {
/** The pattern with its `./` prefix and trailing slashes removed. */
  const cleaned = pattern.replace(/^\.\//, "").replace(/\/+$/, "")
/** The regular-expression source built from the pattern, one character at a time. */
  let source = ""
  for (let index = 0; index < cleaned.length; index += 1) {
/** The pattern character under inspection. */
    const char = cleaned[index] as string
    if (char === "*") {
/** Whether this asterisk starts a `**` segment. */
      const isDouble = cleaned[index + 1] === "*"
      if (isDouble) {
/** Whether the `**` is followed by a slash, which decides its separator semantics. */
        const followedBySlash = cleaned[index + 2] === "/"
        source += followedBySlash ? "(?:[^/]+/)*" : ".*"
        index += followedBySlash ? 2 : 1
      } else {
        source += "[^/]*"
      }
      continue
    }
    if (char === "?") {
      source += "[^/]"
      continue
    }
    source += char.replace(/[.+^${}()|[\]\\]/g, "\\$&")
  }
  return new RegExp(`^${source}(?:/.*)?$`)
}

/** Whether one repository path is admitted by the `files` allowlist patterns. */
function admittedByAllowlist(path: string, patterns: readonly string[]): boolean {
/** The path without a leading `./`, so patterns written either way match it. */
  const normalized = path.replace(/^\.\//, "")
/** Patterns that admit paths. */
  const positive = patterns.filter((pattern) => !pattern.startsWith("!"))
/** Patterns that exclude paths again, without their `!` prefix. */
  const negative = patterns.filter((pattern) => pattern.startsWith("!")).map((pattern) => pattern.slice(1))
/** Whether any admitting pattern matches the path. */
  const admitted = positive.some((pattern) => globMatcher(pattern).test(normalized))
/** Whether an exclusion pattern takes the path back out. */
  const excluded = negative.some((pattern) => globMatcher(pattern).test(normalized))
  return admitted && !excluded
}

/**
 * The `dsh.bundle.patch` declaration as a list of file paths, accepting both the single-file form
 * and the ordered-array form. A declaration of neither shape yields an empty list, which the
 * packaging checks then report as "declares no patch file".
 * @param manifest - the package manifest.
 * @returns the declared patch file paths, in application order.
 */
function patchFilesOf(manifest: Record<string, unknown>): string[] {
  /** The manifest's `dsh` block, or an empty object when it declares none. */
  const dsh = typeof manifest.dsh === "object" && manifest.dsh !== null ? (manifest.dsh as Record<string, unknown>) : {}
  /** The `dsh.bundle` declaration, or an empty object when it declares none. */
  const bundle = typeof dsh.bundle === "object" && dsh.bundle !== null ? (dsh.bundle as Record<string, unknown>) : {}
  /** The patch declaration in whichever accepted form it was written, as a list. */
  const declared = typeof bundle.patch === "string" ? [bundle.patch] : Array.isArray(bundle.patch) ? bundle.patch : []
  return declared.filter((entry): entry is string => typeof entry === "string")
}

/**
 * Every path the installed package must carry for its mounted rows to resolve: the patch files
 * themselves, the module path each row names, the browser client the `dsh.client` declaration
 * points at, and the display metadata the plugin inventory reads.
 * @param patches - the declared patch file paths.
 * @param referenced - every module path the patch files name.
 * @returns the required repository-relative paths, deduplicated.
 */
function requiredPathsOf(patches: readonly string[], referenced: ReadonlySet<string>): string[] {
  return [
    ...new Set([
      ...patches,
      ...referenced,
      "packages/mpd-bundle-plugin/client.js",
      "dsh-plugin.json",
      "icon.svg",
      "locale/en.json",
    ]),
  ]
}

/** Run every packaging check for the repository manifest. */
/**
 * The two shipping descriptors that MUST carry the manifest's own version.
 *
 * WHY THIS IS A GATE AND NOT A NOTE: both files are user-visible identity documents — the DSH plugin
 * descriptor a TUI/ecosystem consumer reads, and the distribution descriptor the TUI distribution case
 * asserts against — and each pins a literal version. Measured 2026-09-28: a release bumped
 * `package.json` alone, the distribution descriptor went stale, and `bun run test:qa` reddened only
 * later inside a QA case. A release step nobody can forget is a rule this gate can check.
 */
const VERSION_CARRIERS: ReadonlyArray<{ readonly file: string; readonly path: readonly string[] }> = [
  // The DSH plugin descriptor carries it at the root.
  { file: "dsh-plugin.json", path: ["version"] },
  // The distribution descriptor carries it INSIDE `distribution` — measured 2026-09-28: a bulk edit
  // wrote the root key instead, the earlier root-first reader accepted it, and the TUI distribution
  // case failed later with `distribution.version must match package.json`. The path is explicit now,
  // and a version anywhere ELSE in the document is a finding of its own.
  { file: "dsh-distribution.json", path: ["distribution", "version"] },
]

/**
 * Read a dotted path out of a parsed JSON document.
 *
 * @param doc - The parsed document.
 * @param path - The key path to walk, in order.
 * @returns The string at that path, or undefined when any step is missing or not an object.
 */
function readPath(doc: unknown, path: readonly string[]): string | undefined {
  /** The value as it is walked down the path. */
  let current: unknown = doc
  for (const key of path) {
    if (typeof current !== "object" || current === null) return undefined
    current = (current as Record<string, unknown>)[key]
  }
  return typeof current === "string" ? current : undefined
}

/**
 * Assert every shipping descriptor carries the manifest's version at its DECLARED key path.
 *
 * @param manifest - The parsed root manifest.
 * @param violations - Collector every finding is appended to.
 * @returns One result per carrier.
 */
function checkVersionCoherence(manifest: Record<string, unknown>, violations: Violation[]): CheckResult[] {
  /** The manifest's own version, the value every carrier must reproduce. */
  const version = typeof manifest.version === "string" ? manifest.version : "(missing)"
  /** One result per descriptor, in a stable order. */
  const results: CheckResult[] = []
  for (const carrier of VERSION_CARRIERS) {
    /** The parsed carrier document, or undefined when it is absent/unreadable. */
    const doc = readJsonFile(join(repoRoot, carrier.file))
    /** The version at the carrier's DECLARED path. */
    const declared = doc === undefined ? undefined : readPath(doc, carrier.path)
    /** A version at the ROOT of a carrier whose path says it lives deeper (or the reverse). */
    const stray = carrier.path.length > 1 && doc !== undefined && typeof (doc as Record<string, unknown>).version === "string"
      ? String((doc as Record<string, unknown>).version)
      : undefined
    /** True when the carrier reproduces the manifest version at the declared path and nowhere else. */
    const ok = declared === version && stray === undefined
    if (!ok) {
      violations.push({
        file: carrier.file,
        rule: "version-coherence",
        detail: stray === undefined
          ? `declares ${String(declared)} at ${carrier.path.join(".")}, package.json says ${version}`
          : `carries a stray root \`version\` (${stray}) — this descriptor's version lives at ${carrier.path.join(".")}`,
      })
    }
    results.push({
      id: `version:${carrier.file}`,
      ok,
      detail: ok ? `${carrier.path.join(".")} = ${version}` : `must be ${version} at ${carrier.path.join(".")}${stray === undefined ? "" : `, with no stray root version`}`,
    })
  }
  return results
}

/**
 * Assert the packaging contract a one-command install rests on: declared patch files exist, every row
 * module path resolves, the `files` allowlist admits every runtime path and `evidence/` stays out.
 *
 * @param manifest - The parsed root manifest.
 * @param violations - Collector every finding is appended to.
 * @returns One result per packaging rule.
 */
function checkPackaging(manifest: Record<string, unknown>, violations: Violation[]): CheckResult[] {
/** One result per packaging check. */
  const results: CheckResult[] = []
/** The declared patch file paths, in application order. */
  const patches = patchFilesOf(manifest)

/** Patch files the manifest names but the package does not carry. */
  const missingPatches = patches.filter((file) => !existsSync(join(repoRoot, file)))
  for (const file of missingPatches) {
    violations.push({ file, rule: "packaging", detail: "dsh.bundle.patch names a file that does not exist in the package" })
  }
  results.push({
    id: "bundle-patch-files",
    ok: missingPatches.length === 0 && patches.length > 0,
    detail: patches.length === 0
      ? "dsh.bundle.patch declares no patch file, so the package can never mount a row"
      : `${patches.length} patch file(s) declared, ${missingPatches.length} missing`,
  })

/** Every module path the patch files name. */
  const referenced = new Set<string>()
/** Patch files that could not be read, reported instead of silently skipped. */
  const unreadable: string[] = []
  for (const file of patches) {
    try {
      for (const path of modulePathsInPatch(readFileSync(join(repoRoot, file), "utf8"))) referenced.add(path)
    } catch {
      unreadable.push(file)
    }
  }
/** Row module paths the package does not carry, which would fail at load time. */
  const missingModules = [...referenced].filter((path) => !existsSync(join(repoRoot, path)))
  for (const path of missingModules) {
    violations.push({ file: path, rule: "packaging", detail: "a mounted row names this module path and the file does not exist" })
  }
  results.push({
    id: "row-module-paths",
    ok: missingModules.length === 0 && unreadable.length === 0,
    detail: `${referenced.size} module path(s) named by the patch files, ${missingModules.length} missing, ${unreadable.length} patch file(s) unreadable`,
  })

/** The `files` allowlist, exactly as the manifest writes it. */
  const allowlist = filesAllowlist(manifest)
/** Every path the installed package must contain for the rows to resolve. */
  const mustShip = requiredPathsOf(patches, referenced)
/** Required paths the allowlist does not admit. */
  const notAdmitted = mustShip.filter((path) => !admittedByAllowlist(path, allowlist))
  for (const path of notAdmitted) {
    violations.push({ file: path, rule: "packaging", detail: "the runtime needs this path and the files allowlist does not admit it" })
  }
  results.push({
    id: "files-allowlist",
    ok: allowlist.length > 0 && notAdmitted.length === 0,
    detail: allowlist.length === 0
      ? "no files allowlist: npm/pnpm packing would ship the whole working tree (including the frozen evidence/ tree)"
      : `${allowlist.length} pattern(s); ${notAdmitted.length} required path(s) not admitted`,
  })

/** A representative frozen-evidence path, used to prove that tree is excluded. */
  const evidenceAdmitted = "evidence/README.md"
  results.push({
    id: "evidence-excluded",
    ok: !admittedByAllowlist(evidenceAdmitted, allowlist),
    detail: admittedByAllowlist(evidenceAdmitted, allowlist)
      ? "the files allowlist admits evidence/**, so a user install would download the frozen QA record tree"
      : "the frozen evidence/ tree stays out of the published package",
  })
  return results
}

/**
 * Ask npm what the package would actually carry, and assert every runtime path is inside it.
 *
 * WHY THIS ARM EXISTS: the allowlist matcher above implements npm's `files` semantics, and an
 * implementation of a rule is not the rule. `npm pack --dry-run --json` is the authority: it runs
 * the real packlist against the real manifest. A path the runtime needs and the tarball does not
 * carry is exactly the defect that turns a one-command user install into a broken boot.
 * @param mustShip - repository-relative paths the installed package must contain.
 * @param violations - violation sink.
 * @returns one check result, or undefined when npm could not be asked.
 */
function checkPackedContent(mustShip: readonly string[], violations: Violation[]): CheckResult | undefined {
  /** Scratch npm cache inside the repository, so the run never writes to the operator's home. */
  const cache = join(repoRoot, ".qa-tmp", "npm-cache")
  mkdirSync(cache, { recursive: true })
  /** The pack run: dry, JSON, no lifecycle execution. */
  const packed = spawnSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, npm_config_cache: cache, npm_config_update_notifier: "false" },
    timeout: 300_000,
  })
  if (packed.status !== 0 || packed.stdout.trim() === "") return undefined
/** The packed entries npm reported, when the document has the expected shape. */
  let entries: Array<{ path: string }>
  try {
/** The first (and only) pack record. */
    const parsed: unknown = JSON.parse(packed.stdout)
/** The pack record's file list, when it is a list. */
    const first = Array.isArray(parsed) ? parsed[0] : undefined
/** The entries that actually carry a path string. */
    const files = typeof first === "object" && first !== null ? (first as { files?: unknown }).files : undefined
    if (!Array.isArray(files)) return undefined
    entries = files.filter((entry): entry is { path: string } => typeof entry === "object" && entry !== null && typeof (entry as { path?: unknown }).path === "string")
  } catch {
    return undefined
  }
  /** The packed paths, as a set for membership tests. */
  const present = new Set(entries.map((entry) => entry.path))
  /** Required paths npm would not carry. */
  const absent = [...new Set(mustShip)].map((path) => path.replace(/^\.\//, "")).filter((path) => !present.has(path))
  for (const path of absent) {
    violations.push({ file: path, rule: "packaging", detail: "npm pack --dry-run does not carry this path, so a user install would miss it" })
  }
  return {
    id: "packed-content",
    ok: absent.length === 0,
    detail: `npm pack --dry-run lists ${entries.length} file(s); ${absent.length} required path(s) absent`,
  }
}

/** Render the human-readable report. */
function render(label: string, results: readonly CheckResult[], violations: readonly Violation[]): string {
/** The report, assembled line by line. */
  const lines = [`# verify-plugin-manifest — ${label}`, ""]
  for (const result of results) lines.push(`${result.ok ? "ok  " : "FAIL"}  ${result.id}: ${result.detail}`)
  lines.push("")
  if (violations.length === 0) {
    lines.push("VERDICT: PASS — the install-time rules and the packaging contract hold.")
  } else {
    lines.push(`VERDICT: FAIL — ${violations.length} violation(s):`)
    for (const violation of violations) lines.push(`  - [${violation.rule}] ${violation.file}: ${violation.detail}`)
  }
  return `${lines.join("\n")}\n`
}

/** Write the immutable evidence pair when `--out` was given. */
function writeEvidence(out: string, payload: unknown, text: string): void {
  mkdirSync(out, { recursive: true })
  writeFileSync(join(out, "result.json"), `${JSON.stringify(payload, null, 2)}\n`, { flag: "wx" })
  writeFileSync(join(out, "output.log"), text, { flag: "wx" })
}

/** The `--self-test` fixture arms: each mutant must fail for its own reason. */
function selfTest(): number {
/** Scratch directory holding this self-test's fixture manifests. */
  const fixtureDir = join(repoRoot, ".qa-tmp", "verify-plugin-manifest-fixtures")
  mkdirSync(fixtureDir, { recursive: true })
/** One mutant per rule, paired with the rule it must trip. */
  const arms: Array<{ name: string; manifest: Record<string, unknown>; expectRule: string }> = [
    {
      name: "cordis-in-dependencies",
      manifest: { name: "x", dependencies: { cordis: "^3" } },
      expectRule: "cordis-dependency",
    },
    {
      name: "cordis-in-optionalDependencies",
      manifest: { name: "x", optionalDependencies: { cordis: "^3" } },
      expectRule: "cordis-dependency",
    },
    {
      name: "cordis-scoped-in-peerDependencies",
      manifest: { name: "x", peerDependencies: { "@cordis/plugin-loader": "^1" } },
      expectRule: "cordis-dependency",
    },
    {
      name: "postinstall-script",
      manifest: { name: "x", scripts: { postinstall: "node build.js" } },
      expectRule: "lifecycle-script",
    },
    {
      name: "prepare-script",
      manifest: { name: "x", scripts: { prepare: "pnpm build" } },
      expectRule: "lifecycle-script",
    },
  ]
/** Number of arms that did not behave as specified. */
  let failures = 0
  for (const arm of arms) {
/** Violations collected for this arm alone. */
    const violations: Violation[] = []
/** The arm's own check results, kept so the call exercises the same path the scan uses. */
    const results = checkHardRules(arm.manifest, arm.name, violations)
/** Whether the expected rule fired for the mutant. */
    const hit = violations.some((violation) => violation.rule === arm.expectRule)
/** The clean control's check results: every rule must stay green on it. */
    const control = checkHardRules({ name: "x", dependencies: { y: "^1" }, scripts: { test: "node t.js" } }, `${arm.name}-control`, [])
/** Whether the clean control passed every rule. */
    const controlClean = control.every((result) => result.ok)
/** Whether the arm proved its rule without a false positive on the control. */
    const ok = hit && controlClean
    if (!ok) failures += 1
    console.log(`${ok ? "ok  " : "FAIL"}  ${arm.name}: expected rule ${arm.expectRule} ${hit ? "fired" : "MISSING"}; clean control ${controlClean ? "green" : "RED"}`)
  }
  // 6th arm: the version-coherence rule, which reads the REAL carriers, so its mutant is a manifest
  // version they cannot all carry and its control is the manifest's own version.
/** Violations the version-coherence mutant produced. */
  const versionViolations: Violation[] = []
  checkVersionCoherence({ name: "x", version: "0.0.0-mutant" }, versionViolations)
/** Whether a manifest version no carrier carries is rejected. */
  const versionHit = versionViolations.some((violation) => violation.rule === "version-coherence")
/** Violations the clean control (the manifest's real version) produced. */
  const versionControlViolations: Violation[] = []
/** The real manifest, read for the control arm. */
  const realManifest = readJsonFile(join(repoRoot, "package.json")) ?? {}
  checkVersionCoherence(realManifest, versionControlViolations)
/** Whether the carriers agree with the manifest that ships them. */
  const versionControlClean = versionControlViolations.length === 0
  if (!(versionHit && versionControlClean)) failures += 1
  console.log(`${versionHit && versionControlClean ? "ok  " : "FAIL"}  version-coherence: expected rule version-coherence ${versionHit ? "fired" : "MISSING"}; clean control ${versionControlClean ? "green" : "RED"}`)
  console.log(failures === 0 ? "self-test PASS (6 arms, each with a clean control)" : `self-test FAIL (${failures} arm(s))`)
  return failures === 0 ? 0 : 1
}

/** Parse `--out <dir>` out of the argument list. */
function outDirOf(argv: readonly string[]): string | undefined {
/** Position of `--out` in the argument list, or -1 when it was not given. */
  const index = argv.indexOf("--out")
/** The directory the caller named, when `--out` was given. */
  const value = index === -1 ? undefined : argv[index + 1]
  return value === undefined ? undefined : resolve(value)
}

/** Gate entry point: self-test, or the repository scan. */
function main(): number {
/** The command-line arguments after the script path. */
  const argv = process.argv.slice(2)
  if (argv.includes("--self-test")) return selfTest()
/** Absolute path of the manifest under inspection. */
  const manifestPath = join(repoRoot, "package.json")
/** The parsed manifest, or undefined when it cannot be read. */
  const manifest = readJsonFile(manifestPath)
  if (manifest === undefined) {
    console.error(`verify-plugin-manifest: cannot read ${manifestPath}`)
    return 1
  }
/** Every violation the scan produced. */
  const violations: Violation[] = []
/** The rule results and the packaging results, in report order. */
  const results = [...checkHardRules(manifest, "package.json", violations), ...checkVersionCoherence(manifest, violations), ...checkPackaging(manifest, violations)]
  if (argv.includes("--pack")) {
    /** The declared patch files, re-read so this arm does not depend on the earlier one. */
    const patches = patchFilesOf(manifest)
    /** Every module path those patch files name. */
    const referenced = new Set(patches.flatMap((file) => {
      try {
        return modulePathsInPatch(readFileSync(join(repoRoot, file), "utf8"))
      } catch {
        return []
      }
    }))
    /** The pack arm's result, absent when npm could not be asked. */
    const packedCheck = checkPackedContent(requiredPathsOf(patches, referenced), violations)
    results.push(packedCheck ?? {
      id: "packed-content",
      ok: false,
      detail: "npm pack --dry-run could not be read, so the packed set is UNKNOWN",
    })
  }
/** The rendered report, printed and optionally stored. */
  const text = render("repository manifest", results, violations)
  process.stdout.write(text)
/** The evidence directory, when the caller asked for one. */
  const out = outDirOf(argv)
  if (out !== undefined) {
    writeEvidence(out, { subject: "package.json", checks: results, violations, verdict: violations.length === 0 ? "pass" : "fail" }, text)
  }
  return violations.length === 0 ? 0 : 1
}

process.exitCode = main()
